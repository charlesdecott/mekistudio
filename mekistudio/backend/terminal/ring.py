"""ScrollbackRing — tampon borné de la sortie d'un terminal, PUR (testable sans PTY).

Chaque chunk reçoit un `seq` monotone : c'est ce qui permet le `attach{since_seq}`
(une reconnexion live ne rejoue que le nouveau). Le tampon est borné en nombre de
caractères : au-delà, les plus VIEUX chunks entiers sont évincés (jamais coupés au
milieu d'une séquence ANSI), mais on garde toujours au moins le dernier chunk. Le
`text()` (concat) sert à la persistance disque ; `load()` réamorce depuis le disque."""
from __future__ import annotations


class ScrollbackRing:
    def __init__(self, cap_chars: int = 200_000) -> None:
        self._cap = max(1, int(cap_chars))
        self._chunks: list[tuple[int, str]] = []  # (seq, text)
        self._next_seq = 1
        self._size = 0  # somme des longueurs des chunks

    def append(self, text: str) -> dict:
        """Ajoute un chunk, renvoie l'event wire `{"type":"output","seq","data"}`."""
        seq = self._next_seq
        self._next_seq += 1
        self._chunks.append((seq, text))
        self._size += len(text)
        self._evict()
        return {"type": "output", "seq": seq, "data": text}

    def _evict(self) -> None:
        # Évince les plus vieux chunks ENTIERS tant qu'on dépasse le cap ; on garde
        # toujours au moins un chunk (le plus récent), même s'il dépasse à lui seul.
        while self._size > self._cap and len(self._chunks) > 1:
            _, txt = self._chunks.pop(0)
            self._size -= len(txt)

    def since(self, seq: int) -> list[dict]:
        """Chunks dont le seq est strictement supérieur à `seq` (pour le replay)."""
        return [
            {"type": "output", "seq": s, "data": t}
            for (s, t) in self._chunks
            if s > seq
        ]

    def text(self) -> str:
        """Concat de tout le scrollback (pour la persistance disque)."""
        return "".join(t for (_, t) in self._chunks)

    def load(self, text: str) -> None:
        """Réamorce le ring depuis un texte persisté (un chunk seq=1, prochain=2).
        Tronqué à la FIN sur `cap` pour rester borné même si le fichier a grossi."""
        self._chunks = []
        self._size = 0
        self._next_seq = 1
        if text:
            if len(text) > self._cap:
                text = text[-self._cap:]
            self.append(text)
