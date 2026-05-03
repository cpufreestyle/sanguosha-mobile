@echo off
set JAVA_HOME=D:\Android\jdk\openjdk-17
set PATH=%JAVA_HOME%\bin;%PATH%
cd /d D:\qclaw-workspace\sanguosha-mobile
python build_apk.py
