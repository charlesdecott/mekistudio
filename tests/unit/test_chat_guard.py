from mekistudio.backend.chat.guard import make_repo_guard


def _deny(r):
    return r.get("hookSpecificOutput", {}).get("permissionDecision") == "deny"


async def _call(guard, name, **inp):
    return await guard({"tool_name": name, "tool_input": inp}, "tid", None)


async def test_guard_confines_read_ls(tmp_path):
    g = make_repo_guard(tmp_path)
    # in-repo (relatif & absolu) -> allow ({})
    assert await _call(g, "Read", file_path="sub/a.py") == {}
    assert await _call(g, "Read", file_path=str(tmp_path / "a.py")) == {}
    assert await _call(g, "LS", path="sub") == {}
    # hors-repo / .. -> deny
    assert _deny(await _call(g, "Read", file_path="C:/Windows/hosts"))
    assert _deny(await _call(g, "Read", file_path="../../secret"))
    # chemin manquant / vide / non-string -> deny ; ne lève jamais
    assert _deny(await _call(g, "Read"))
    assert _deny(await _call(g, "Read", file_path=""))
    assert _deny(await _call(g, "Read", file_path=["x"]))
    # outil hors liste lecture -> deny (ceinture)
    assert _deny(await _call(g, "Bash", command="ls"))
    assert _deny(await _call(g, "Write", file_path="a.py", content="x"))


async def test_guard_glob_grep_pattern(tmp_path):
    g = make_repo_guard(tmp_path)
    assert await _call(g, "Glob", pattern="src/**") == {}            # relatif -> borné par cwd
    assert _deny(await _call(g, "Glob", pattern="C:/Windows/**"))    # pattern absolu hors-repo
    assert _deny(await _call(g, "Glob", path="../x", pattern="**"))  # path .. hors-repo
    assert await _call(g, "Grep", pattern="seq") == {}              # pattern = regex de contenu (pas un chemin)
    assert _deny(await _call(g, "Grep", pattern="x", glob="C:/etc/**"))  # glob absolu hors-repo


async def test_guard_glob_brace_expansion_escape(tmp_path):
    # Le moteur glob du SDK EXPANSE les accolades AVANT résolution : un arm '..' énumère hors-repo
    # alors que le pattern LITTÉRAL "résout" in-repo (pathlib ne traite pas les accolades). Bug #2.
    g = make_repo_guard(tmp_path)
    assert _deny(await _call(g, "Glob", pattern="{..,ok}/**"))
    assert _deny(await _call(g, "Glob", pattern="{../../Windows,sub}/**"))
    assert _deny(await _call(g, "Glob", pattern="{../*,x}"))
    assert _deny(await _call(g, "Glob", pattern="sub/{..,..}/etc/hosts"))
    assert _deny(await _call(g, "Glob", pattern="{C:/Windows,sub}/**"))  # arm absolu hors-repo
    assert _deny(await _call(g, "Grep", pattern="x", glob="{..,ok}/**"))
    # non-régression : accolades légitimes 100% in-repo -> allow
    assert await _call(g, "Glob", pattern="src/{a,b}/**") == {}
    assert await _call(g, "Glob", pattern="**/*.py") == {}
