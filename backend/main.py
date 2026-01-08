import os

from dotenv import load_dotenv
from fastapi import FastAPI

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

app = FastAPI()


@app.get("/")
def root():
    return {"message": "hello free world"}
