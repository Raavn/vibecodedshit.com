from http.server import BaseHTTPRequestHandler

from core.base import Base


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)


class Child(Base):
    def run(self):
        return 2


class Plain:
    def helper(self):
        return 3


HANDLERS = [Handler, Child, Plain]
