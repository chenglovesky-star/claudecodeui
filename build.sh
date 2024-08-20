#!/usr/bin/env bash
echo "mvn build $env start..."

mvn clean -U package -DskipTests

echo "mvn build $env end... "