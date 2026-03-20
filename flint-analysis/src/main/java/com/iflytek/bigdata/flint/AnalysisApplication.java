package com.iflytek.bigdata.flint;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;
import springfox.documentation.swagger2.annotations.EnableSwagger2;

/**
 * @Author: linlong
 * @Date: 2024/8/5
 * @Desc:
 */
@SpringBootApplication
@MapperScan("com.iflytek.bigdata.flint.*.dao.mapper")
@EnableScheduling
@EnableSwagger2
public class AnalysisApplication {
    public static void main(String[] args) {
        SpringApplication.run(AnalysisApplication.class,args);

    }
}
