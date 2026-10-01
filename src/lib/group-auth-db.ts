import "server-only";

import argon2 from "argon2";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";

export interface GroupUserRow extends RowDataPacket {
  id: number;
  username: string;
  name: string | null;
  password: string;
  level: number | null;
  email: string | null;
  affiliation: string | null;
  approved: number | null;
  firstname: string | null;
  lastname: string | null;
}

export type GroupAdminUser = Pick<
  GroupUserRow,
  "id" | "username" | "level" | "email" | "firstname" | "lastname"
>;

export interface GroupPasskeyRow extends RowDataPacket {
  id: number;
  user_id: number;
  credential_id: string;
  public_key: string;
  sign_count: number;
  device_name: string;
  created_at: Date | null;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

export interface KinomeXAuthState extends RowDataPacket {
  user_id: number;
  session_epoch: number;
  disabled: number;
}

export interface KinomeXChallenge extends RowDataPacket {
  id: string;
  user_id: number;
  type: string;
  challenge: string;
  expires_at: Date;
  used_at: Date | null;
}

let pool: Pool | null = null;
let schemaPromise: Promise<void> | null = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DBHOST || "db",
      port: Number(process.env.DBPORT || 3306),
      user: process.env.DBUSER,
      password: process.env.DBPASS,
      database: process.env.DBDOKH || "dokhlab",
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      charset: "utf8mb4",
      timezone: "Z",
    });
  }
  return pool;
}

export async function ensureKinomeXAuthSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = getPool();
      await db.query(`
        create table if not exists kinomex_auth_state (
          user_id bigint not null primary key,
          session_epoch bigint not null default 0,
          disabled tinyint not null default 0,
          created_at timestamp not null default current_timestamp,
          updated_at timestamp not null default current_timestamp on update current_timestamp,
          key idx_kinomex_auth_state_disabled (disabled)
        ) engine=InnoDB
      `);
      await db.query(`
        create table if not exists kinomex_password_recovery_codes (
          id bigint not null auto_increment primary key,
          user_id bigint not null,
          code_hash varchar(255) not null,
          used_at datetime null,
          created_at timestamp not null default current_timestamp,
          key idx_kinomex_recovery_user (user_id, used_at)
        ) engine=InnoDB
      `);
      await db.query(`
        create table if not exists kinomex_auth_challenges (
          id char(64) not null primary key,
          user_id bigint not null,
          type varchar(64) not null,
          challenge varchar(255) not null,
          expires_at datetime not null,
          used_at datetime null,
          created_at timestamp not null default current_timestamp,
          key idx_kinomex_challenge_lookup (user_id, type, expires_at, used_at)
        ) engine=InnoDB
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export async function getGroupUserById(userId: number) {
  await ensureKinomeXAuthSchema();
  const [rows] = await getPool().query<GroupUserRow[]>(
    "select id, username, name, password, level, email, affiliation, approved, firstname, lastname from users where id=? limit 1",
    [userId],
  );
  return rows[0] || null;
}

export async function getGroupUserByUsername(username: string) {
  await ensureKinomeXAuthSchema();
  const [rows] = await getPool().query<GroupUserRow[]>(
    "select id, username, name, password, level, email, affiliation, approved, firstname, lastname from users where lower(username)=lower(?) limit 1",
    [username.trim()],
  );
  return rows[0] || null;
}

/**
 * Keep KinomeX's authorization decision aligned with Group's canonical rule:
 * level 10, an explicit GROUP_ADMIN_USERS entry, or the admin permission
 * group attached through a linked/fallback member record.
 *
 * This is intentionally evaluated from the database for every account load;
 * the browser-visible isAdmin flag is only a rendering hint.
 */
export async function isGroupAdmin(user: GroupAdminUser) {
  if (Number(user.level || 0) === 10) return true;

  const configuredUsers = new Set(
    (process.env.GROUP_ADMIN_USERS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (configuredUsers.has(user.username)) return true;

  try {
    await ensureKinomeXAuthSchema();
    const [rows] = await getPool().query<RowDataPacket[]>(
      `
        select 1
        from group_member_permission_groups gmpg
        join group_permission_groups gpg on gmpg.group_id = gpg.id
        where gpg.name = 'admin'
          and gmpg.mem_id in (
            select link.mem_id
            from group_member_user_links link
            where link.user_id = ?
            union
            select m.mem_id
            from mems m
            where ? <> '' and lower(m.email) = lower(?)
            union
            select m.mem_id
            from mems m
            where ? <> '' and ? <> ''
              and lower(m.f_name) = lower(?)
              and lower(m.l_name) = lower(?)
          )
        limit 1
      `,
      [
        user.id,
        user.email || "",
        user.email || "",
        user.firstname || "",
        user.lastname || "",
        user.firstname || "",
        user.lastname || "",
      ],
    );
    return rows.length > 0;
  } catch {
    // Group's level and explicit username rules remain authoritative even if
    // an older deployment has not created the optional permission tables yet.
    return false;
  }
}

export async function getGroupPasskeys(userId: number) {
  await ensureKinomeXAuthSchema();
  const [rows] = await getPool().query<GroupPasskeyRow[]>(
    "select id, user_id, credential_id, public_key, sign_count, device_name, created_at, last_used_at, revoked_at from group_user_passkeys where user_id=? and revoked_at is null order by created_at desc",
    [userId],
  );
  return rows;
}

export async function getGroupPasskey(userId: number, credentialId: string) {
  await ensureKinomeXAuthSchema();
  const [rows] = await getPool().query<GroupPasskeyRow[]>(
    "select id, user_id, credential_id, public_key, sign_count, device_name, created_at, last_used_at, revoked_at from group_user_passkeys where user_id=? and credential_id=? and revoked_at is null limit 1",
    [userId, credentialId],
  );
  return rows[0] || null;
}

export async function addGroupPasskey(input: {
  userId: number;
  credentialId: string;
  publicKey: string;
  signCount: number;
  deviceName?: string;
}) {
  await ensureKinomeXAuthSchema();
  await getPool().execute(
    "insert into group_user_passkeys (user_id, credential_id, public_key, sign_count, device_name) values (?, ?, ?, ?, ?)",
    [input.userId, input.credentialId, input.publicKey, input.signCount, input.deviceName || "KinomeX Passkey"],
  );
}

export async function updateGroupPasskeyCounter(passkeyId: number, signCount: number) {
  await ensureKinomeXAuthSchema();
  await getPool().execute(
    "update group_user_passkeys set sign_count=?, last_used_at=utc_timestamp() where id=? and revoked_at is null",
    [signCount, passkeyId],
  );
}

export async function getAuthState(userId: number) {
  await ensureKinomeXAuthSchema();
  await getPool().execute("insert ignore into kinomex_auth_state (user_id) values (?)", [userId]);
  const [rows] = await getPool().query<KinomeXAuthState[]>(
    "select user_id, session_epoch, disabled from kinomex_auth_state where user_id=? limit 1",
    [userId],
  );
  return rows[0] || { user_id: userId, session_epoch: 0, disabled: 0 };
}

export async function bumpSessionEpoch(userId: number) {
  await ensureKinomeXAuthSchema();
  await getPool().execute(
    "update kinomex_auth_state set session_epoch=session_epoch+1 where user_id=?",
    [userId],
  );
}

export async function setKinomeXDisabled(userId: number, disabled: boolean) {
  await ensureKinomeXAuthSchema();
  await getPool().execute(
    "update kinomex_auth_state set disabled=?, session_epoch=session_epoch+1 where user_id=?",
    [disabled ? 1 : 0, userId],
  );
}

export async function isGroupTotpEnabled(userId: number) {
  await ensureKinomeXAuthSchema();
  const [rows] = await getPool().query<RowDataPacket[]>(
    "select totp_enabled from group_user_security where user_id=? limit 1",
    [userId],
  );
  return Boolean(rows[0]?.totp_enabled);
}

export async function verifyGroupPassword(password: string, storedHash: string) {
  if (!storedHash) return false;
  if (storedHash.startsWith("$argon2")) {
    try {
      return await argon2.verify(storedHash, password);
    } catch {
      return false;
    }
  }
  const legacy = createHash("md5").update(password, "utf8").digest("hex");
  const actual = Buffer.from(legacy, "utf8");
  const expected = Buffer.from(storedHash, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function hashGroupPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

export function createRecoveryCode() {
  return Array.from({ length: 4 }, () => randomBytes(3).toString("hex").toUpperCase()).join("-");
}

export async function replacePasswordRecoveryCode(userId: number, code: string) {
  await ensureKinomeXAuthSchema();
  const db = getPool();
  const hash = await argon2.hash(code.replace(/\s+/g, "").toUpperCase(), { type: argon2.argon2id });
  await db.execute("delete from kinomex_password_recovery_codes where user_id=?", [userId]);
  await db.execute(
    "insert into kinomex_password_recovery_codes (user_id, code_hash) values (?, ?)",
    [userId, hash],
  );
}

export async function consumePasswordRecoveryCode(userId: number, code: string) {
  await ensureKinomeXAuthSchema();
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>(
      "select id, code_hash from kinomex_password_recovery_codes where user_id=? and used_at is null order by created_at desc for update",
      [userId],
    );
    let matchingId: number | null = null;
    for (const row of rows) {
      try {
        if (await argon2.verify(String(row.code_hash), code.replace(/\s+/g, "").toUpperCase())) {
          matchingId = Number(row.id);
          break;
        }
      } catch {
        // Ignore malformed or legacy rows and continue checking the rest.
      }
    }
    if (!matchingId) {
      await connection.rollback();
      return false;
    }
    const [result] = await connection.execute<ResultSetHeader>(
      "update kinomex_password_recovery_codes set used_at=utc_timestamp() where id=? and used_at is null",
      [matchingId],
    );
    if (result.affectedRows !== 1) {
      await connection.rollback();
      return false;
    }
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function createAuthChallenge(userId: number, type: string, challenge: string) {
  await ensureKinomeXAuthSchema();
  const id = randomBytes(32).toString("hex");
  await getPool().execute(
    "insert into kinomex_auth_challenges (id, user_id, type, challenge, expires_at) values (?, ?, ?, ?, date_add(utc_timestamp(), interval 5 minute))",
    [id, userId, type, challenge],
  );
  return id;
}

export async function consumeAuthChallenge(id: string, userId: number, type: string) {
  await ensureKinomeXAuthSchema();
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<KinomeXChallenge[]>(
      "select id, user_id, type, challenge, expires_at, used_at from kinomex_auth_challenges where id=? and user_id=? and type=? and used_at is null and expires_at>utc_timestamp() for update",
      [id, userId, type],
    );
    const row = rows[0];
    if (!row) {
      await connection.rollback();
      return null;
    }
    const [result] = await connection.execute<ResultSetHeader>(
      "update kinomex_auth_challenges set used_at=utc_timestamp() where id=? and used_at is null",
      [id],
    );
    if (result.affectedRows !== 1) {
      await connection.rollback();
      return null;
    }
    await connection.commit();
    return row;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function consumeAuthChallengeByValue(userId: number, type: string, challenge: string) {
  await ensureKinomeXAuthSchema();
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<KinomeXChallenge[]>(
      "select id, user_id, type, challenge, expires_at, used_at from kinomex_auth_challenges where user_id=? and type=? and challenge=? and used_at is null and expires_at>utc_timestamp() order by created_at desc limit 1 for update",
      [userId, type, challenge],
    );
    const row = rows[0];
    if (!row) {
      await connection.rollback();
      return null;
    }
    const [result] = await connection.execute<ResultSetHeader>(
      "update kinomex_auth_challenges set used_at=utc_timestamp() where id=? and used_at is null",
      [row.id],
    );
    if (result.affectedRows !== 1) {
      await connection.rollback();
      return null;
    }
    await connection.commit();
    return row;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function createGroupUser(input: {
  name: string;
  username: string;
  password: string;
}) {
  await ensureKinomeXAuthSchema();
  const passwordHash = await hashGroupPassword(input.password);
  const pieces = input.name.trim().split(/\s+/).filter(Boolean);
  const firstname = pieces.shift() || input.username;
  const lastname = pieces.join(" ");
  const db = getPool();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query<RowDataPacket[]>(
      "select id from users where lower(username)=lower(?) limit 1 for update",
      [input.username],
    );
    if (existing[0]) {
      await connection.rollback();
      return null;
    }
    const [result] = await connection.execute<ResultSetHeader>(
      "insert into users (username, name, password, email, approved, affiliation, firstname, lastname, level) values (?, ?, ?, '', 0, '', ?, ?, 1)",
      [input.username, input.name.trim(), passwordHash, firstname, lastname],
    );
    await connection.execute("insert ignore into kinomex_auth_state (user_id) values (?)", [result.insertId]);
    await connection.commit();
    return getGroupUserById(Number(result.insertId));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateGroupUserName(userId: number, name: string) {
  const pieces = name.trim().split(/\s+/).filter(Boolean);
  const firstname = pieces.shift() || "";
  const lastname = pieces.join(" ");
  await ensureKinomeXAuthSchema();
  await getPool().execute(
    "update users set name=?, firstname=?, lastname=? where id=?",
    [name.trim(), firstname, lastname, userId],
  );
}

export async function updateGroupUserPassword(userId: number, password: string) {
  await ensureKinomeXAuthSchema();
  const passwordHash = await hashGroupPassword(password);
  await getPool().execute("update users set password=? where id=?", [passwordHash, userId]);
  await bumpSessionEpoch(userId);
}
