package com.iflytek.bigdata.flint.hiveserver2.service;

import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;

public interface IMetastoreService {

    List<String> listDatabase();

    List<String> listTable(String database);

    List<Map<String, Object>> listColumn(String database, String table);

    List<Map<String, Object>> sample(String database, String table);

    List<Map<String, Object>> tableStat(String database, String table);

    JdbcTemplate getJdbcTemplate();
}
