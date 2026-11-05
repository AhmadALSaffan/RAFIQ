"""Rafiq's look in the terminal (repl.py), drawn by hand pixel by pixel: the character from
the app's pages, holding its laptop, and the white mark. Two pixels make one character cell
(▀ with the top pixel as the colour and the bottom one as the background).

"." is transparent; the other letters are PALETTE colours."""

PALETTE = {
    "K": "#605e58",  # lines
    "H": "#3a3934",  # hair
    "W": "#f4f2ea",  # face, shirt, the mark
    "S": "#d6d2c8",  # the laptop's lid
    "O": "#e98a32",  # the orange on the laptop
}

PEEP = [
    "..........HHHHHHHH..........",
    ".......HHHHHHHHHHHHHH.......",
    ".....HHHHHHHHHHHHHHHHHH.....",
    "....HHHHHHHHHHHHHHHHHHH.....",
    "....HHHHHWWWWWWWWHHHHH......",
    "....HHHWWWWWWWWWWWWWHH......",
    "....HHWWWWWWWWWWWWWWWK......",
    "....HKWKKKKWWWWKKKKWWK......",
    "...KWWKWWWKKKKKKWWWKWK......",
    "...KWWKWWWKWWWWKWWWKWK......",
    "....KWWKKKKWWWWKKKKWK.......",
    ".....KWWWWWWWWWWWWWWK.......",
    "......KWWWWKKKKWWWWK........",
    ".......KKWWWWWWWWKK.........",
    ".........KWWWWWWK...........",
    ".......KKKKWWWWKKKK.........",
    ".....KKWWWWKKKKWWWWKKK......",
    "....KWWWWWWWKWWKWWWWWWK.....",
    "...KWWWWWWWWWKKWWWWWWWWK....",
    "..KWWWWKWWWWWWWWWWWWWKKKKKKK",
    "..KWWWWKWWWWWWWWWWWWKSSSSSSK",
    ".KWWWWWWWWWWWWWWWWWKSSSSSSSK",
    ".KWWWWWWWWWWWWWWWWWKSSSSOSSK",
    ".KWWWWWWWWWWWWWWWWKSSSSOOOSK",
    ".KWWWWWWWWKKKKKWWWKSSSSSSSSK",
    ".KKKKKKKKKWWWWWKKKKKKKKKKKKK",
    ".KWWWWWWWKWKKKWKWWWWK.......",
    "..KWWWWWWWKWWWKWWWWK........",
    "...KWWWWWWWWWWWWWWK.........",
    "....KKKKKKKKKKKKKKK.........",
]

MARK = [
    "...........WWWW.",
    "..........W....W",
    "..........W.WW.W",
    "........WWW....W",
    ".......W..WWWWW.",
    "......W....W....",
    ".....W......W...",
    "....W...........",
    "...W............",
    "..W.............",
    ".W..............",
    "W...............",
]


def half_blocks(rows: list[str]):
    """The drawing as a rich Text of half blocks."""
    from rich.style import Style
    from rich.text import Text

    if len(rows) % 2:
        rows = [*rows, "." * len(rows[0])]
    out = Text()
    for y in range(0, len(rows), 2):
        for top, bottom in zip(rows[y], rows[y + 1], strict=True):
            up, down = PALETTE.get(top), PALETTE.get(bottom)
            if up and down:
                out.append("▀", Style(color=up, bgcolor=down))
            elif up:
                out.append("▀", Style(color=up))
            elif down:
                out.append("▄", Style(color=down))
            else:
                out.append(" ")
        if y + 2 < len(rows):
            out.append("\n")
    return out
