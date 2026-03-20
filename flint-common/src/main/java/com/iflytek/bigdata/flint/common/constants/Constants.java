package com.iflytek.bigdata.flint.common.constants;

import java.text.SimpleDateFormat;
import java.time.format.DateTimeFormatter;

public class Constants {

    public static final int SUCCESS_CODE = 0;

    public static class SDF {
        public static final SimpleDateFormat SDF_YMDHM = new SimpleDateFormat("yyyy-MM-dd HH:mm");

        public static final SimpleDateFormat SDF_YMDH = new SimpleDateFormat("yyyy-MM-dd-HH");

        public static final SimpleDateFormat SDF_YMD = new SimpleDateFormat("yyyy-MM-dd");
    }

    public static class DTF {

        public static final DateTimeFormatter DTF_YMDH = DateTimeFormatter.ofPattern("yyyy-MM-dd-HH");

        public static final DateTimeFormatter DTF_YMD = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    }

    public static final String MAIN_COMPONENT = "Main";

    public static final String TAB_COMPONENT = "tab";

    public static final String PATH_PREFIX = "/report";

    public static final String PATH_END_PREFIX = "/report?params=";

    public static final String DIM_FIELD_TYPE = "dim";

    public static final String VAL_FIELD_TYPE = "val";

    public static final String TABLE_NAME = "tableName";

    public static final String VAL_NAME = "valName";

    public static final String HOUR = "hour";

    public static final String DAY = "day";

    public static final String WEEK = "week";

    public static final String MONTH = "month";

    public static final int NAME_LENGTH = 15;
}
