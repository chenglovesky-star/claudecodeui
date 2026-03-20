CREATE TABLE k_dim
(
    id              int(11) NOT NULL AUTO_INCREMENT COMMENT 'ID',
    name            varchar(128) NOT NULL COMMENT '维度名称',
    hive_table_name varchar(64)  NOT NULL COMMENT '维度表',
    dim_column      varchar(128) NOT NULL COMMENT '维度字段',
    event           varchar(64)  NOT NULL COMMENT '事件',
    property        varchar(128) NOT NULL COMMENT '映射属性',
    username        varchar(30)  NOT NULL COMMENT '创建人',
    status          int(11) NOT NULL COMMENT '维表状态',
    create_time     timestamp    NOT NULL COMMENT '创建时间',
    update_time     timestamp    NOT NULL COMMENT '编辑时间',
    PRIMARY KEY (id),
    UNIQUE KEY uniq_n (name),
    UNIQUE KEY uniq_t (hive_table_name, event)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 ROW_FORMAT = COMPRESSED COMMENT = '维表';
CREATE TABLE k_dim_column
(
    id        int(11) NOT NULL AUTO_INCREMENT COMMENT 'ID',
    dim_id    int(11) NOT NULL COMMENT '维度表ID',
    name      varchar(128) NOT NULL DEFAULT '' COMMENT '维表属性名称',
    show_name varchar(128) NOT NULL DEFAULT '' COMMENT '维表属性显示名称',
    type      varchar(32)  NOT NULL DEFAULT '' COMMENT '维表属性类型',
    display   int(11) NOT NULL DEFAULT 1 COMMENT '维表字段是否显示',
    PRIMARY KEY (id),
    INDEX     idx_dim_id(dim_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 ROW_FORMAT = COMPRESSED COMMENT = '维表列';

alter table k_dim_column drop column `partition`;
alter table k_dim add column `partition` varchar(64) default '' comment '分区属性';
