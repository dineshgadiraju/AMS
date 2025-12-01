FROM ubuntu:latest
LABEL authors="SDAI Group 2"

WORKDIR /home/app/

COPY ./backend /home/app/

RUN python3 --version && \
    pip3 install -r requirements.txt

CMD ["python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8888"]
