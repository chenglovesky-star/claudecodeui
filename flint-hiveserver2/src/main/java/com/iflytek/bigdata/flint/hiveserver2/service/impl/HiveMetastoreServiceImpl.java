package com.iflytek.bigdata.flint.hiveserver2.service.impl;

import com.iflytek.bigdata.flint.hiveserver2.service.IMetastoreService;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service("hiveMetastoreService")
public class HiveMetastoreServiceImpl implements IMetastoreService {

//    @Autowired
//    @Qualifier("hiveJdbcTemplate")
    private JdbcTemplate hiveJdbcTemplate;

    @Override
    public List<Map<String, Object>> listColumn(String database, String table) {
        JdbcTemplate hiveJdbcTemplate = this.hiveJdbcTemplate;
        return hiveJdbcTemplate.queryForList("describe " + database + "." + table);
    }

    @Override
    public List<Map<String, Object>> sample(String database, String table) {
        JdbcTemplate hiveJdbcTemplate = this.hiveJdbcTemplate;
        return hiveJdbcTemplate.queryForList("select * from  " + database + "." + table + " limit 10");
    }

    @Override
    public List<Map<String, Object>> tableStat(String database, String table) {
        List<Map<String, Object>> statList = new ArrayList<>();
        List<Map<String, Object>> formateds = describeFormatted(database, table);
        boolean flag = false;
        for (Map<String, Object> formated : formateds) {
            String c1 = (String) formated.get("col_name");
            String c2 = (String) formated.get("data_type");
            Object c3 = formated.get("comment");
            if (flag) {
                Map<String, Object> stat = new HashMap<>();
                stat.put("key", c2);
                stat.put("value", c3);
                statList.add(stat);
                if (StringUtils.isEmpty(c1) && StringUtils.isEmpty(c2)) {
                    break;
                }
            }
            if ("Table Parameters:".equals(c1)) flag = true;
        }
        return statList;
    }

    private List<Map<String, Object>> describeFormatted(String database, String table) {
        JdbcTemplate hiveJdbcTemplate = this.hiveJdbcTemplate;
        return hiveJdbcTemplate.queryForList("DESCRIBE FORMATTED " + database + "." + table);
    }

    @Override
    public JdbcTemplate getJdbcTemplate() {
        JdbcTemplate hiveJdbcTemplate = this.hiveJdbcTemplate;
        return hiveJdbcTemplate;
    }

    @Override
    public List<String> listDatabase() {
        JdbcTemplate hiveJdbcTemplate = this.hiveJdbcTemplate;
        return hiveJdbcTemplate.queryForList("show databases", String.class);
    }

    @Override
    public List<String> listTable(String database) {
        JdbcTemplate hiveJdbcTemplate = this.hiveJdbcTemplate;
        String sql = "use " + database;
        hiveJdbcTemplate.execute(sql);
        return hiveJdbcTemplate.queryForList("show tables", String.class);
    }
}
