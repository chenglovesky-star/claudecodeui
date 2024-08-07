# 创建数据库
CREATE DATABASE flint;

CREATE TABLE impala_query_history
(
    id            bigint(20)  NOT NULL AUTO_INCREMENT COMMENT '查询id,用bigint类型防止32位整数溢出',
    query_time    datetime    NOT NULL COMMENT '用户发起查询的时间',
    query_request longtext    NOT NULL COMMENT '查询条件',
    query_sql     text        NOT NULL COMMENT '查询语句',
    username      varchar(30) NOT NULL COMMENT '发起查询的用户名',
    status        int(11)     NOT NULL COMMENT '查询状态, QueryHistoryStatusEnum',
    start_time    timestamp   NULL DEFAULT NULL COMMENT '开始时间',
    end_time      timestamp   NULL DEFAULT NULL COMMENT '结束时间',
    period        bigint(11)       DEFAULT '0' COMMENT '查询时长',
    message longtext  COMMENT '查询信息',
    PRIMARY KEY (id),
    KEY idx_user_query_time (username, query_time)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  ROW_FORMAT = COMPRESSED COMMENT ='事件查询历史记录表';


CREATE TABLE impala_query_result
(
    id            bigint(20) NOT NULL AUTO_INCREMENT COMMENT '结果ID,用bigint类型防止32位整数溢出',
    history_id    bigint(20) NOT NULL COMMENT '查询历史ID',
    query_sql     text       NOT NULL COMMENT '查询语句',
    origin_result longtext   NOT NULL COMMENT '查询结果原始内容',
    PRIMARY KEY (id),
    UNIQUE KEY history (history_id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  ROW_FORMAT = COMPRESSED COMMENT ='事件查询结果记录表';
