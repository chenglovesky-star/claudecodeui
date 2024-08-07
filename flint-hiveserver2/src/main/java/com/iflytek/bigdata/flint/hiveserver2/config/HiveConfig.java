package com.iflytek.bigdata.flint.hiveserver2.config;

import com.alibaba.druid.pool.DruidDataSource;
import lombok.Data;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;

@Configuration
@ConfigurationProperties(prefix = "hiveserver2")
@Component
@Data
public class HiveConfig {

    @Value("${env:dev}")
    private String env;

    @Value("${url:url}")
    private String url;

    @Value("${backupUrl:backupUrl}")
    private String backupUrl;

    @Value("${impalaUrl:impalaUrl}")
    private String impalaUrl;

    @Value("${sparkUrl:sparkUrl}")
    private String sparkUrl;

    @Value("${user:user}")
    private String user;

    @Value("${password:password}")
    private String password;

    @Value("${driverClassName:driverClassName}")
    private String driverClassName;

    @Value("${impalaDriverClassName:impalaDriverClassName}")
    private String impalaDriverClassName;

    @Value("${initialSize:1}")
    private int initialSize;

    @Value("${minIdle:1}")
    private int minIdle;

    @Value("${maxActive:1}")
    private int maxActive;

    @Value("${maxWait:1000}")
    private int maxWait;

    @Value("${timeBetweenEvictionRunsMillis:1000}")
    private int timeBetweenEvictionRunsMillis;

    @Value("${minEvictableIdleTimeMillis:1000}")
    private int minEvictableIdleTimeMillis;

    @Value("${validationQuery:validationQuery}")
    private String validationQuery;

    @Value("${testWhileIdle:false}")
    private boolean testWhileIdle;

    @Value("${testOnBorrow:false}")
    private boolean testOnBorrow;

    @Value("${testOnReturn:false}")
    private boolean testOnReturn;

    @Value("${poolPreparedStatements:false}")
    private boolean poolPreparedStatements;

    @Value("${maxPoolPreparedStatementPerConnectionSize:1}")
    private int maxPoolPreparedStatementPerConnectionSize;



    @Primary
    @Qualifier("hiveDataSource")
    public DataSource hiveDataSource() {

        DruidDataSource datasource = new DruidDataSource();
        datasource.setUrl(url);
        datasource.setUsername(user);
        datasource.setPassword(password);
        datasource.setDriverClassName(driverClassName);

        // pool configuration
        datasource.setInitialSize(initialSize);
        datasource.setMinIdle(minIdle);
        datasource.setMaxActive(maxActive);
        datasource.setMaxWait(maxWait);
        datasource.setTimeBetweenEvictionRunsMillis(timeBetweenEvictionRunsMillis);
        datasource.setMinEvictableIdleTimeMillis(minEvictableIdleTimeMillis);
        datasource.setValidationQuery(validationQuery);
        datasource.setTestWhileIdle(testWhileIdle);
        datasource.setTestOnBorrow(testOnBorrow);
        datasource.setTestOnReturn(testOnReturn);
        datasource.setPoolPreparedStatements(poolPreparedStatements);
        datasource.setMaxPoolPreparedStatementPerConnectionSize(maxPoolPreparedStatementPerConnectionSize);
        return datasource;
    }

    @Primary
    public JdbcTemplate hiveJdbcTemplate(@Qualifier("hiveDataSource") DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }

    @Primary
    @Qualifier("hiveBackupDataSource")
    public DataSource hiveBackupDataSource() {

        DruidDataSource datasource = new DruidDataSource();
        datasource.setUrl(backupUrl);
        datasource.setUsername(user);
        datasource.setPassword(password);
        datasource.setDriverClassName(driverClassName);

        // pool configuration
        datasource.setInitialSize(initialSize);
        datasource.setMinIdle(minIdle);
        datasource.setMaxActive(maxActive);
        datasource.setMaxWait(maxWait);
        datasource.setTimeBetweenEvictionRunsMillis(timeBetweenEvictionRunsMillis);
        datasource.setMinEvictableIdleTimeMillis(minEvictableIdleTimeMillis);
        //datasource.setValidationQuery(validationQuery);
        //datasource.setTestWhileIdle(testWhileIdle);
        datasource.setTestOnBorrow(testOnBorrow);
        datasource.setTestOnReturn(testOnReturn);
        datasource.setPoolPreparedStatements(poolPreparedStatements);
        datasource.setMaxPoolPreparedStatementPerConnectionSize(maxPoolPreparedStatementPerConnectionSize);
        return datasource;
    }

    @Primary
    public JdbcTemplate hiveBackupJdbcTemplate(@Qualifier("hiveBackupDataSource") DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }

    @Primary
    @Qualifier("impalaDataSource")
    public DataSource impalaDataSource() {

        DruidDataSource datasource = new DruidDataSource();
        datasource.setUrl(impalaUrl);
        datasource.setUsername(user);
        datasource.setPassword(password);
        datasource.setDriverClassName(impalaDriverClassName);

        // pool configuration
        datasource.setInitialSize(initialSize);
        datasource.setMinIdle(minIdle);
        datasource.setMaxActive(maxActive);
        datasource.setMaxWait(maxWait);
        datasource.setTimeBetweenEvictionRunsMillis(timeBetweenEvictionRunsMillis);
        datasource.setMinEvictableIdleTimeMillis(minEvictableIdleTimeMillis);
        datasource.setValidationQuery(validationQuery);
        datasource.setTestWhileIdle(testWhileIdle);
        datasource.setTestOnBorrow(testOnBorrow);
        datasource.setTestOnReturn(testOnReturn);
        datasource.setPoolPreparedStatements(poolPreparedStatements);
        datasource.setMaxPoolPreparedStatementPerConnectionSize(maxPoolPreparedStatementPerConnectionSize);
        return datasource;
    }

    @Primary
    public JdbcTemplate impalaJdbcTemplate(@Qualifier("impalaDataSource") DataSource impalaDataSource) {
        return new JdbcTemplate(impalaDataSource);
    }

    @Primary
    @Qualifier("sparkDataSource")
    public DataSource sparkDataSource() {

        DruidDataSource datasource = new DruidDataSource();
        datasource.setUrl(sparkUrl);
        datasource.setUsername(user);
        datasource.setPassword(password);
        datasource.setDriverClassName(driverClassName);

        // pool configuration
        datasource.setInitialSize(initialSize);
        datasource.setMinIdle(minIdle);
        datasource.setMaxActive(maxActive);
        datasource.setMaxWait(maxWait);
        datasource.setTimeBetweenEvictionRunsMillis(timeBetweenEvictionRunsMillis);
        datasource.setMinEvictableIdleTimeMillis(minEvictableIdleTimeMillis);
        //datasource.setValidationQuery(validationQuery);
        //datasource.setTestWhileIdle(testWhileIdle);
        datasource.setTestOnBorrow(testOnBorrow);
        datasource.setTestOnReturn(testOnReturn);
        datasource.setPoolPreparedStatements(poolPreparedStatements);
        datasource.setMaxPoolPreparedStatementPerConnectionSize(maxPoolPreparedStatementPerConnectionSize);
        return datasource;
    }

    @Primary
    public JdbcTemplate sparkJdbcTemplate(@Qualifier("sparkDataSource") DataSource sparkDataSource) {
        return new JdbcTemplate(sparkDataSource);
    }
}
