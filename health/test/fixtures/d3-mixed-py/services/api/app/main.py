from app.api.routes import users


def create_app():
    return users.f()
