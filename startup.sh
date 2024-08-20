#!/usr/bin/env bash
#  startup.sh默认置于项目根目录下
jvmOpts="-server -XX:+DisableExplicitGC -Xms1024m -Xmx1024m -XX:+UseG1GC -XX:+DisableExplicitGC"
if [[ "$env" == "production"  ]]; then
    jvmOpts="-server -XX:+DisableExplicitGC -Xms2048m -Xmx2048m -XX:+UseG1GC -XX:+DisableExplicitGC"
fi
java $jvmOpts \
    -Dspring.config.location=classpath:config/$env/application.yaml \
    -Dlogging.config=classpath:config/$env/log.xml \
    -jar $serviceName.jar 
