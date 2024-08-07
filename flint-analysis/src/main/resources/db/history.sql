CREATE TABLE history_stat
(
    id             int(11)     NOT NULL COMMENT '主键' AUTO_INCREMENT,
    query_date     date        NOT NULL COMMENT '统计日期',
    query_type     smallint(5) NOT NULL COMMENT '查询类型',
    query_user     varchar(64) NOT NULL COMMENT '查询人',
    query_count    int(11)    DEFAULT 0 COMMENT '查询次数',
    query_duration bigint(20) DEFAULT 0 COMMENT '查询时长',
    error_query    int(11)    DEFAULT 0 COMMENT '查询错误次数',
    slow_query     int(11)    DEFAULT 0 COMMENT '慢查询次数',
    PRIMARY KEY (`id`),
    KEY K_USER (query_user),
    KEY K_TYPE (query_type)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  ROW_FORMAT = COMPRESSED COMMENT ='查询历史统计表';


CREATE TABLE history
(
    id            bigint(11)  NOT NULL COMMENT '查询ID',
    type          varchar(16) NOT NULL COMMENT '查询类型',
    query_time    datetime    NOT NULL COMMENT '用户发起查询的时间',
    query_request longtext    NOT NULL COMMENT '查询条件',
    query_sql     text        NOT NULL COMMENT '查询语句',
    username      varchar(30) NOT NULL COMMENT '发起查询的用户名',
    status        int(11)     NOT NULL COMMENT '查询状态, QueryHistoryStatusEnum',
    start_time    timestamp   NULL DEFAULT NULL COMMENT '开始时间',
    end_time      timestamp   NULL DEFAULT NULL COMMENT '结束时间',
    `period`      bigint(11)       DEFAULT '0' COMMENT '查询时长',
    message       longtext COMMENT '查询信息',
    PRIMARY KEY (`type`, `id`),
    KEY K_QT (`query_time`),
    KEY K_USER (`username`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  ROW_FORMAT = COMPRESSED COMMENT ='查询历史表';