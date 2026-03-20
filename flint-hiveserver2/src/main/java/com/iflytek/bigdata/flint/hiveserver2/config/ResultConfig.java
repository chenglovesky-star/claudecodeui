package com.iflytek.bigdata.flint.hiveserver2.config;

public class ResultConfig {

    public final static String HIVE_RESULT_FIELD_DELIMITER = "\001\001";        //hive默认列分隔符^A的八进制编码，这里是两个^A

    public final static String HIVE_RESULT_FIELD_DELIMITER_FOR_MYSQL = "\t";

    public final static String HIVE_RESULT_FILE_DIR = "data/";

    /**
     * 获取数据文件绝对路径
     *
     * @param username
     * @param queryHistId
     * @return
     */
    public final static String getDataFileName(String username, long queryHistId) {
        return String.format("%s%s-%d.txt", HIVE_RESULT_FILE_DIR, username, queryHistId);
    }

    public final static String getLogFileName(String username, long queryHistId) {
        return String.format("%s%s-%d-log.txt", HIVE_RESULT_FILE_DIR, username, queryHistId);
    }

    /**
     * 获取meta文件绝对路径
     *
     * @param username
     * @param queryHistId
     * @return
     */
    public final static String getMetaFileName(String username, long queryHistId) {
        return String.format("%s%s-%d.meta", HIVE_RESULT_FILE_DIR, username, queryHistId);
    }
}
