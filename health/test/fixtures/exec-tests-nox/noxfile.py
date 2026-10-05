import nox


@nox.session
def tests(session):
    session.run("python", "-m", "unittest", "discover")
