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

@Service("impalaMetastoreService")
public class ImpalaMetastoreServiceImpl implements IMetastoreService {

//    @Autowired
//    @Qualifier("impalaJdbcTemplate")
    private JdbcTemplate impalaJdbcTemplate;

    @Override
    public List<Map<String, Object>> listColumn(String database, String table) {
        impalaJdbcTemplate.execute("use " + database);
        return impalaJdbcTemplate.queryForList("describe " + table);
    }

    @Override
    public List<Map<String, Object>> sample(String database, String table) {
        impalaJdbcTemplate.execute("use " + database);
        return impalaJdbcTemplate.queryForList("select * from  " + table + " limit 50");
    }

    @Override
    public List<Map<String, Object>> tableStat(String database, String table) {
        List<Map<String, Object>> statList = new ArrayList<>();
        List<Map<String, Object>> formateds = describeFormatted(database, table);
        boolean flag = false;
        for (Map<String, Object> formated : formateds) {
            String c1 = (String) formated.get("name");
            String c2 = (String) formated.get("type");
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
        impalaJdbcTemplate.execute("use " + database);
        return impalaJdbcTemplate.queryForList("DESCRIBE FORMATTED " + table);
    }
    @Override
    public JdbcTemplate getJdbcTemplate() {
        return impalaJdbcTemplate;
    }

    @Override
    public List<String> listDatabase() {
        List<String> databases = new ArrayList<>();
        List<Map<String, Object>> list = impalaJdbcTemplate.queryForList("show databases");
        for (Map<String, Object> stringObjectMap : list) {
            databases.add((String) stringObjectMap.get("name"));
        }
        return databases;
    }

    @Override
    public List<String> listTable(String database) {
        String sql = "use " + database;
        impalaJdbcTemplate.execute(sql);
        return impalaJdbcTemplate.queryForList("show tables", String.class);
    }
}
