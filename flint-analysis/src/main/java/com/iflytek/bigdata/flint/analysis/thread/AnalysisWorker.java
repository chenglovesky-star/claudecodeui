package com.iflytek.bigdata.flint.analysis.thread;

import com.alibaba.fastjson.JSONObject;
import com.iflytek.bigdata.flint.hiveserver2.config.HiveConfig;
import org.apache.commons.lang3.StringUtils;
import org.springframework.jdbc.core.ColumnMapRowMapper;

import java.sql.*;
import java.util.*;
import java.util.concurrent.Callable;

public class AnalysisWorker implements Callable<String> {

    private final static Integer LIMIT = 10000;

    private final static String HIVE = "hive";
    private final static String SPARK = "spark";

    private final String sqlComment_withJobId = "/*@jobGroupId=%s*/ ";

    private final HiveConfig hiveConfig;

    private final String sql;

    private final Long queryHistoryId;

    private final String jdbcType;

    private String hiveEngine;

    public AnalysisWorker(HiveConfig hiveConfig, String sql, long queryHistoryId, String jdbcType,
                          String hiveEngine) {
        this.hiveConfig = hiveConfig;
        this.sql = sql;
        this.queryHistoryId = queryHistoryId;
        this.jdbcType = jdbcType;
        this.hiveEngine = hiveEngine;
    }

    private void initImpalaUdfs(Statement statement) {
        try {
            String udfs =
                    "create function if not exists json_array_contains_all(String,String) returns Boolean location \"/etl/lib/iflytek-udfs-uber.jar\" SYMBOL=\"com.iflytek.hive.udf.UDFJsonArrayContainsAll\";"
                            + "create function if not exists json_map_contains_any(String,String) returns Boolean location \"/etl/lib/iflytek-udfs-uber.jar\" SYMBOL=\"com.iflytek.hive.udf.UDFJsonMapContainsAny\";"
                            + "create function if not exists json_array_contains_any(String,String) returns Boolean location \"/etl/lib/iflytek-udfs-uber.jar\" SYMBOL=\"com.iflytek.hive.udf.UDFJsonArrayContainsAny\";"
                            + "create function if not exists json_map_contains_all(String,String) returns Boolean location \"/etl/lib/iflytek-udfs-uber.jar\" SYMBOL=\"com.iflytek.hive.udf.UDFJsonMapContainsAll\"";
            String[] arrs = udfs.split(";");
            for (String arr : arrs) {
                statement.execute(arr);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void initHiveUdfs(Statement statement) {
        try {
            String udfs = "add jar hdfs://dins1/etl/lib/iflytek-udfs-analysis.jar;"
                    + "CREATE TEMPORARY FUNCTION json_array_contains_all as 'com.iflytek.hive.udf.UDFJsonArrayContainsAll';"
                    + "CREATE TEMPORARY FUNCTION json_map_contains_any as 'com.iflytek.hive.udf.UDFJsonMapContainsAny';"
                    + "CREATE TEMPORARY FUNCTION json_array_contains_any as 'com.iflytek.hive.udf.UDFJsonArrayContainsAny';"
                    + "CREATE TEMPORARY FUNCTION json_map_contains_all as 'com.iflytek.hive.udf.UDFJsonMapContainsAll';";
            String[] arrs = udfs.split(";");
            for (String arr : arrs) {
                statement.execute(arr);
            }
            if (!"spark".equals(this.hiveEngine)) {
                statement.execute("set mapred.job.name=metis_analysis_" + this.queryHistoryId);
                statement.execute("set mapred.job.queue.name=root.hdfs");
                statement.execute("set hive.map.aggr = true");
                statement.execute("set hive.groupby.skewindata = true");
                statement.execute("set hive.resultset.use.unique.column.names=false");
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public String call() throws Exception {
        Connection connection = null;
        Statement statement = null;
        try {
            Properties info = new Properties();
            info.setProperty("user", this.hiveConfig.getImpalaUsername());
            if (StringUtils.isNotEmpty(hiveConfig.getImpalaPassword())) {
                info.setProperty("password", hiveConfig.getImpalaPassword());
            }

            Class.forName(hiveConfig.getImpalaDriverClassName());
            connection = DriverManager.getConnection(hiveConfig.getImpalaUrl(), info);

            statement = connection.createStatement();
            String[] arr = sql.split("###");
            String query = arr[1];

            List<Map<String, Object>> resultList = new ArrayList<>();
            ResultSet result = statement.executeQuery(query + " LIMIT " + LIMIT);
            if (result != null) {
                int i = 0;
                while (result.next()) {
                    //限制最大的结果
                    if (++i >= LIMIT) break;
                    ColumnMapRowMapper rowMapper = new ColumnMapRowMapper();
                    resultList.add(rowMapper.mapRow(result, 1));
                }
            }
            Map<String, Object> resultMap = new HashMap<>();
            resultMap.put("sql", sql);
            resultMap.put("result", resultList);
            return JSONObject.toJSONString(resultMap);
        } catch (Exception e) {
            e.printStackTrace();
            throw e;
        } finally {
            try {
                if (statement != null) statement.close();
            } catch (SQLException throwables) {

            }
            try {
                if (connection != null) connection.close();
            } catch (SQLException throwables) {

            }
        }
    }

}
