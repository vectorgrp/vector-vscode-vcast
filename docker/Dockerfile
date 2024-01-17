FROM ubuntu:24.04

# VCAST
WORKDIR /
ADD ./vcast /vcast
COPY ./vector-DEMO.lic /vector-DEMO.lic
ENV VECTORCAST_DIR=/vcast
ENV PATH=$VECTORCAST_DIR:$PATH
ENV VECTOR_LICENSE_FILE=/vector-DEMO.lic

# LIBS
RUN apt-get update && apt-get install -y curl
RUN curl -kfsSL https://deb.nodesource.com/setup_18.x | bash - && apt-get install -y nodejs
RUN apt-get install -y npm && npm install --silent -g @vscode/vsce@^2.15.04
RUN apt-get install -y gcc-10 g++-10 && \
    update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-10 30 && \
    update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-10 30 && \
    update-alternatives --install /usr/bin/cc cc /usr/bin/gcc 30 && update-alternatives --set cc /usr/bin/gcc && \
    update-alternatives --install /usr/bin/c++ c++ /usr/bin/g++ 30 && update-alternatives --set c++ /usr/bin/g++

WORKDIR /root
