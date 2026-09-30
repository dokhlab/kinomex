import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("evaluate_assistant", Path(__file__).resolve().parents[2] / "scripts" / "evaluate_assistant.py")
ev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ev)


def test_statements_extract_citations_per_row_and_sentence():
    answer = (
        "| Kinase | Evidence | References |\n|---|---|---|\n"
        "| [CSNK1D](/kinases/CSNK1D) | Regulates PER2. | [PMID: 123; DOI: 10.1000/abc] |\n"
        "CAMKK2 activates AMPK [PMID: 456; DOI: 10.2000/x.y]. KinomeX lists 24 structures."
    )
    found = ev.statements(answer)
    assert [(p, d) for _, p, d in found] == [("123", "10.1000/abc"), ("456", "10.2000/x.y")]
    assert found[1][0].startswith("CAMKK2 activates AMPK")


def test_wilson_interval():
    lo, hi = ev.wilson(8, 10)
    assert round(lo, 3) == 0.490 and round(hi, 3) == 0.943


def test_cohen_kappa():
    a = ["supported"] * 6 + ["not_supported"] * 4
    assert ev.cohen_kappa(a, a) == 1.0
    b = ["supported"] * 5 + ["not_supported"] * 5
    assert round(ev.cohen_kappa(a, b), 3) == 0.8
