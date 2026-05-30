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
