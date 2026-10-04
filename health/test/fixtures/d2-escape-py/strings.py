def text() -> str:
    return "# type: ignore and typing.cast(1) and Any"

class Any:
    pass

def own(a: Any) -> None:
    return None
