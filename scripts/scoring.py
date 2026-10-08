"""전사 결과를 대본과 정렬해 표현별 만족 여부와 점수를 계산한다."""
import json
import re
from pathlib import Path

DEFAULT_CFG = json.loads((Path(__file__).with_name("scoring.json")).read_text(encoding="utf-8"))

ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
        "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
ORDINAL = {"1": "first", "2": "second", "3": "third", "5": "fifth", "8": "eighth", "9": "ninth", "12": "twelfth"}
CONTRACTIONS = {("i", "am"): "i'm", ("it", "is"): "it's", ("he", "is"): "he's", ("she", "is"): "she's",
                ("that", "is"): "that's", ("what", "is"): "what's", ("let", "us"): "let's", ("i", "have"): "i've",
                ("i", "will"): "i'll", ("i", "would"): "i'd", ("you", "are"): "you're", ("do", "not"): "don't",
                ("does", "not"): "doesn't", ("can", "not"): "can't", ("is", "not"): "isn't", ("i", "had"): "i'd"}


def num_words(n: int) -> list[str]:
    if n < 20:
        return [ONES[n]]
    if n < 100:
        return [TENS[n // 10]] + ([ONES[n % 10]] if n % 10 else [])
    if n < 1000:
        return [ONES[n // 100], "hundred"] + (num_words(n % 100) if n % 100 else [])
    if 1100 <= n < 2000 and n % 100:  # 1995 → nineteen ninety five
        return num_words(n // 100) + num_words(n % 100)
    if n < 10000:
        return num_words(n // 1000) + ["thousand"] + (num_words(n % 1000) if n % 1000 else [])
    return [str(n)]


def ordinal_words(n: str) -> list[str]:
    if n in ORDINAL:
        return [ORDINAL[n]]
    w = num_words(int(n))
    last = w[-1]
    if last.endswith("y"):
        w[-1] = last[:-1] + "ieth"
    elif last == "one":
        w[-1] = "first"
    elif last == "two":
        w[-1] = "second"
    elif last == "three":
        w[-1] = "third"
    elif last == "five":
        w[-1] = "fifth"
    elif last == "eight":
        w[-1] = "eighth"
    elif last == "nine":
        w[-1] = "ninth"
    else:
        w[-1] = last + "th"
    return w


def canonical(text: str) -> list[str]:
    t = text.lower()
    t = t.replace("’", "'").replace("‘", "'")
    t = re.sub(r"[−–-]\s*(?=\d)", " minus ", t)          # −58 → minus 58
    t = re.sub(r"\$\s*(\d+)", r"\1 dollars", t)          # $25 → 25 dollars
    t = re.sub(r"(\d+)\s*(℃|°\s*c|degrees?\s+celsius)", r"\1 degrees", t)
    t = re.sub(r"(\d+)(st|nd|rd|th)\b", lambda m: " ".join(ordinal_words(m.group(1))), t)
    t = re.sub(r"\d+", lambda m: " ".join(num_words(int(m.group(0)))), t)
    t = re.sub(r"[^a-z' ]+", " ", t)
    toks = [w.strip("'") for w in t.split()]
    toks = [w for w in toks if w]
    out = []
    i = 0
    while i < len(toks):
        if i + 1 < len(toks) and (toks[i], toks[i + 1]) in CONTRACTIONS:
            out.append(CONTRACTIONS[(toks[i], toks[i + 1])]); i += 2
        else:
            out.append(toks[i]); i += 1
    return out


def align(ref: list[str], hyp: list[str]) -> list[tuple]:
    """Needleman-Wunsch. 일치 +2, 대체 -1, 삽입/삭제 -1."""
    n, m = len(ref), len(hyp)
    score = [[0] * (m + 1) for _ in range(n + 1)]
    back = [[None] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        score[i][0] = -i; back[i][0] = "up"
    for j in range(1, m + 1):
        score[0][j] = -j; back[0][j] = "left"
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            diag = score[i - 1][j - 1] + (2 if ref[i - 1] == hyp[j - 1] else -1)
            up = score[i - 1][j] - 1
            left = score[i][j - 1] - 1
            best = max(diag, up, left)
            score[i][j] = best
            back[i][j] = "diag" if best == diag else ("up" if best == up else "left")
    pairs = []
    i, j = n, m
    while i > 0 or j > 0:
        b = back[i][j]
        if b == "diag":
            pairs.append((i - 1, j - 1)); i -= 1; j -= 1
        elif b == "up":
            pairs.append((i - 1, None)); i -= 1
        else:
            pairs.append((None, j - 1)); j -= 1
    return list(reversed(pairs))


def expand_words(words: list[dict]) -> list[dict]:
    """Scribe 단어를 정규화 토큰으로 펼친다(한 단어가 여러 토큰이 되면 타임스탬프 공유)."""
    toks = []
    for w in words:
        if w.get("type", "word") != "word":
            continue
        for tok in canonical(w["text"]):
            toks.append({"tok": tok, "start": float(w["start"]), "end": float(w["end"])})
    # 축약형은 단어 경계를 넘어 합친다(전사가 "I" "am"을 따로 줄 때 대본의 "i'm"과 맞도록).
    out = []
    i = 0
    while i < len(toks):
        if i + 1 < len(toks) and (toks[i]["tok"], toks[i + 1]["tok"]) in CONTRACTIONS:
            out.append({"tok": CONTRACTIONS[(toks[i]["tok"], toks[i + 1]["tok"])],
                        "start": toks[i]["start"], "end": toks[i + 1]["end"]})
            i += 2
        else:
            out.append(toks[i]); i += 1
    return out


def score_dialogue(dialogue: dict, scribe: dict, turn_offsets: list, cfg: dict) -> dict:
    hyp_all = expand_words(scribe.get("words", []))
    offsets = {o["turn"]: o for o in turn_offsets}
    results = []
    for u in dialogue["units"]:
        off = offsets[u["n"]]
        hyp = [w for w in hyp_all if off["start"] - 0.25 <= w["start"] <= off["end"] + 0.25]
        exprs = [e for e in dialogue["expressions"] if e["unit"] == u["n"]]
        ref, owner = [], []
        for e in exprs:
            toks = canonical(e["text"])
            ref += toks; owner += [e["n"]] * len(toks)
        pairs = align(ref, [w["tok"] for w in hyp])
        for e in exprs:
            idxs = {k for k, o in enumerate(owner) if o == e["n"]}
            matched = [(r, h) for r, h in pairs if r in idxs and h is not None]
            hits = sum(1 for r, h in matched if ref[r] == hyp[h]["tok"])
            aligned = sorted({h for _, h in matched})
            match_ratio = hits / len(idxs) if idxs else 0.0
            transcript = " ".join(hyp[h]["tok"] for h in aligned)
            if not aligned:
                results.append({"n": e["n"], "text": e["text"], "transcript": "", "match_ratio": 0.0,
                                "max_gap": None, "wpm": None, "ok": False, "reason": "no_words"})
                continue
            gaps = [hyp[b]["start"] - hyp[a]["end"] for a, b in zip(aligned, aligned[1:])]
            max_gap = max(gaps) if gaps else 0.0
            span = hyp[aligned[-1]]["end"] - hyp[aligned[0]]["start"]
            wpm = (len(aligned) / (span / 60)) if (span > 0 and len(aligned) > 1) else None
            reason = ""
            if match_ratio < cfg["match_ratio_min"]:
                reason = "match_ratio"
            elif max_gap > cfg["max_gap_sec"]:
                reason = "max_gap"
            elif wpm is not None and wpm < cfg["wpm_min"]:
                reason = "wpm"
            results.append({"n": e["n"], "text": e["text"], "transcript": transcript,
                            "match_ratio": round(match_ratio, 3), "max_gap": round(max_gap, 2),
                            "wpm": (round(wpm, 1) if wpm is not None else None), "ok": reason == "", "reason": reason})
    results.sort(key=lambda r: r["n"])
    satisfied = sum(1 for r in results if r["ok"])
    return {"satisfied": satisfied, "score": dialogue_score(satisfied), "expressions": results}


def dialogue_score(satisfied: int) -> int:
    if satisfied >= 9:
        return 10
    if satisfied >= 1:
        return satisfied + 1
    return 1


def final_score(scores: list[int]) -> int:
    if not scores:
        return 0
    x = sum(scores) / len(scores)
    return int(x + 0.5)
