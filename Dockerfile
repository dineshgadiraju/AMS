FROM ubuntu:latest
LABEL authors="SDAI Group 2"

WORKDIR /home/app/

COPY ./app /home/app/

COPY main.py /home/app/

COPY requirements.txt /home/app/

RUN python3 --version && pip3 install -r requirements.txt

CMD ["ls"]