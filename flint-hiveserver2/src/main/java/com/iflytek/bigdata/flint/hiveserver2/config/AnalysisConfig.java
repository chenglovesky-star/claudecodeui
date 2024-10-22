package com.iflytek.bigdata.flint.hiveserver2.config;

import lombok.Data;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Component;


/**
 * @Author: linlong
 * @Date: 2024/8/7
 * @Desc:
 */
@Configuration
@ConfigurationProperties(prefix = "spring.hive")
@Component
@Data
public class AnalysisConfig {

    @Value("${APP_ENV:production}")
    private String env;


    @Value("${profileTable:hive.profile.dm_up_v_user}")
    private String profileTable;


    @Value("${eventsTable:hive.ossp.dw_d_ime_operationlog_sr}")
    private String eventsTable;

    @Value("${abtestTable:hive.ossp.dw_d_ime_operationabtestlog_sr}")
    private String abtestTable;
}