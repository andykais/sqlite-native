#!/bin/bash

cd $(dirname $0)

wget https://sqlite.org/2022/sqlite-amalgamation-3390200.zip
unzip ./sqlite-amalgamation-3390200.zip
mv ./sqlite-amalgamation-3390200 sqlite-source
rm ./sqlite-amalgamation-3390200.zip
