DROP TABLE IF EXISTS virtual_event;
CREATE TABLE virtual_event
(
    id           int(11)      NOT NULL AUTO_INCREMENT COMMENT '结果ID,用bigint类型防止32位整数溢出',
    name         varchar(128) NOT NULL DEFAULT '' COMMENT '虚拟事件名称',
    display_name varchar(255) NOT NULL DEFAULT '' COMMENT '显示名称',
    description  varchar(255)          DEFAULT '' COMMENT '描述',
    tags         varchar(1024) COMMENT '标签',
    event_filter longtext comment '事件过滤',
    event_sql    text comment '事件解析sql',
    add_user     varchar(64)           DEFAULT '' COMMENT '添加人',
    add_time     timestamp    NULL COMMENT '添加时间',
    PRIMARY KEY (id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  ROW_FORMAT = COMPRESSED COMMENT ='虚拟事件表';


create table operation
(
    id             int(11) unsigned not null auto_increment comment 'ID',
    name           varchar(64)      not null comment '比较类型名称',
    description    varchar(255)              default null comment '描述',
    select_type    int(11)          not null default 0 comment '参数选择类型，0-无输入框 1-1输入/单选框 2-2输入框 3-1多选/输入框 4-1输入日期框 5-2输入日期框 6-1输入框',
    column_type    int(11)          not null default 0 comment '列值类型，0-整型 1-浮点型 2-字符串 3-数组 4-map 5-日期 6-Boolean',
    query_template varchar(255)              default null comment '查询模板',
    status         int(11)          not null default 0 comment '状态：0有效，-1失效',
    created        timestamp        null comment '创建时间',
    created_by     varchar(64)      not null comment '创建人',
    updated        timestamp        null comment '修改时间',
    updated_by     varchar(64)      null     default null comment '修改人',
    primary key (id),
    unique key uniq_name_column (name, column_type)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8 comment '比较类型表';
INSERT INTO `operation`
VALUES (1, 'GreaterThan', '大于', 1, 0, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (2, 'GreaterThan', '大于', 1, 1, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (3, 'GreaterThan', '大于', 4, 5, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (4, 'GreaterThanOrEqualTo', '大于等于', 1, 0, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28',
        'linlong'),
       (5, 'GreaterThanOrEqualTo', '大于等于', 1, 1, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28',
        'linlong'),
       (6, 'GreaterThanOrEqualTo', '大于等于', 4, 5, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28',
        'linlong'),
       (7, 'LessThan', '小于', 1, 0, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (8, 'LessThan', '小于', 1, 1, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (9, 'LessThan', '小于', 4, 5, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (10, 'LessThanOrEqualTo', '小于等于', 1, 0, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28',
        'linlong'),
       (11, 'LessThanOrEqualTo', '小于等于', 1, 1, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28',
        'linlong'),
       (12, 'LessThanOrEqualTo', '小于等于', 4, 5, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28',
        'linlong'),
       (13, 'Between', '区间（包含）', 2, 0, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (14, 'Between', '区间（包含）', 2, 1, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (15, 'Between', '区间（包含）', 5, 5, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (16, 'EqualTo', '等于', 1, 0, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (17, 'EqualTo', '等于', 1, 2, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (18, 'EqualTo', '等于', 4, 5, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (19, 'NotEqualTo', '不等于', 1, 0, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (20, 'NotEqualTo', '不等于', 1, 2, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (21, 'NotEqualTo', '不等于', 4, 5, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (22, 'Null', '为空', 0, 0, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (23, 'Null', '为空', 0, 1, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (24, 'Null', '为空', 0, 2, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (25, 'Null', '为空', 0, 3, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (26, 'Null', '为空', 0, 4, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (27, 'Null', '为空', 0, 5, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (28, 'NotNull', '不为空', 0, 0, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (29, 'NotNull', '>不为空', 0, 1, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (30, 'NotNull', '不为空', 0, 2, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (31, 'NotNull', '不为空', 0, 3, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (32, 'NotNull', '不为空', 0, 4, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (33, 'NotNull', '不为空', 0, 5, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (34, 'Like', '模糊匹配', 1, 2, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (35, 'ContainAll', '全部包含', 3, 3, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (36, 'ContainAll', '全部包含', 3, 4, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (37, 'ContainAny', '任意包含', 3, 3, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (38, 'ContainAny', '任意包含', 3, 4, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (39, 'DaysBefore', 'N天之前', 1, 5, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (40, 'DaysIn', 'N天以内', 1, 5, NULL, 0, '2024-09-10 08:30:28', 'linlong', '2024-09-10 08:30:28', 'linlong'),
       (41, 'ContainAny', '任意包含', 3, 2, NULL, 0, '2024-09-11 02:18:28', 'linlong', '2024-09-11 02:18:28', 'linlong'),
       (42, 'ContainAny', '任意包含', 3, 0, NULL, 0, '2024-09-11 02:23:12', 'linlong', '2024-09-11 02:23:12', 'linlong'),
       (43, 'Equal', '等于', 1, 6, NULL, 0, '2024-09-11 03:04:00', 'linlong', '2024-09-11 03:04:00', 'linlong'),
       (44, 'GreaterThan', '大于', 1, 2, NULL, 0, '2024-10-08 08:30:28', 'ddzhang6', '2024-10-08 08:30:28', 'ddzhang6'),
       (45, 'LessThan', '小于', 1, 2, NULL, 0, '2024-10-08 08:30:28', 'ddzhang6', '2024-10-08 08:30:28', 'ddzhang6'),
       (46, 'GreaterThanOrEqualTo', '大于等于', 1, 2, NULL, 0, '2024-10-08 08:30:28', 'ddzhang6', '2024-10-08 08:30:28', 'ddzhang6'),
       (47, 'LessThanOrEqualTo', '小于等于', 1, 2, NULL, 0, '2024-10-08 08:30:28', 'ddzhang6', '2024-10-08 08:30:28', 'ddzhang6');



DROP table if exists metadata_event;
CREATE TABLE metadata_event
(
    id          int(11)      NOT NULL AUTO_INCREMENT COMMENT '结果ID,用bigint类型防止32位整数溢出',
    name        varchar(128) NOT NULL DEFAULT '' COMMENT '事件名称',
    show_name   varchar(128) NOT NULL DEFAULT '' COMMENT '事件展示名称',
    description varchar(1024)         DEFAULT '' COMMENT '事件描述',
    tags        varchar(128)          DEFAULT '' COMMENT '事件标签',
    display     int(11)      NOT NULL DEFAULT 1 COMMENT '是否显示',
    PRIMARY KEY (id),
    UNIQUE KEY u_name (name)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  ROW_FORMAT = COMPRESSED COMMENT ='元数据-事件表';

DROP table if exists metadata_event_property;
CREATE TABLE metadata_event_property
(
    id         int(11)      NOT NULL AUTO_INCREMENT COMMENT '结果ID,用bigint类型防止32位整数溢出',
    event_name varchar(128) NOT NULL DEFAULT '' COMMENT '事件名称',
    name       varchar(128) NOT NULL DEFAULT '' COMMENT '属性名称',
    show_name  varchar(128) NOT NULL DEFAULT '' COMMENT '属性显示名称',
    type       varchar(32)  NOT NULL DEFAULT '' COMMENT '属性类型',
    display    int(11)      NOT NULL DEFAULT 1 COMMENT '是否显示',
    PRIMARY KEY (id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  ROW_FORMAT = COMPRESSED COMMENT ='元数据-事件属性表';

DROP table if exists metadata_profile_category;
CREATE TABLE metadata_profile_category
(
    id        int(11)      NOT NULL AUTO_INCREMENT COMMENT '结果ID,用bigint类型防止32位整数溢出',
    name      varchar(128) NOT NULL DEFAULT '' COMMENT '事件名称',
    show_name varchar(128) NOT NULL DEFAULT '' COMMENT '事件展示名称',
    display   int(11)      NOT NULL DEFAULT 1 COMMENT '是否显示',
    PRIMARY KEY (id),
    UNIQUE KEY u_name (name)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  ROW_FORMAT = COMPRESSED COMMENT ='元数据-画像分类';

DROP table if exists metadata_profile_column;
CREATE TABLE metadata_profile_column
(
    id          int(11)      NOT NULL AUTO_INCREMENT COMMENT '结果ID,用bigint类型防止32位整数溢出',
    category_id int(11)      NOT NULL DEFAULT 0 COMMENT '画像属性分类ID',
    name        varchar(128) NOT NULL DEFAULT '' COMMENT '画像属性名称',
    show_name   varchar(128) NOT NULL DEFAULT '' COMMENT '画像属性显示名称',
    type        varchar(32)  NOT NULL DEFAULT '' COMMENT '画像属性类型',
    display     int(11)      NOT NULL DEFAULT 1 COMMENT '是否显示',
    PRIMARY KEY (id),
    UNIQUE KEY u_name (name)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  ROW_FORMAT = COMPRESSED COMMENT ='元数据-画像属性表';


alter table virtual_event
    add column display int(11) NOT NULL DEFAULT 1 COMMENT '是否显示';



alter table metadata_event
    add column modules varchar(64) default '' comment '业务线标示';


alter table metadata_profile_column
    add column enum_values varchar(1024) DEFAULT '' COMMENT '枚举值';


alter table metadata_event
    add column sort int(11) default 0 comment '排序值';

alter table metadata_event_property
    add column sort int(11) default 0 comment '排序值';

alter table metadata_event
    add column priority int(11) default 0 comment '优先级';


CREATE TABLE metadata_event_property_value
(
    id       int(11)      NOT NULL AUTO_INCREMENT COMMENT '结果ID,用bigint类型防止32位整数溢出',
    event    varchar(128) NOT NULL DEFAULT '' COMMENT '事件名称',
    property varchar(255) NOT NULL DEFAULT '' COMMENT '属性名称',
    value    longtext     NOT NULL COMMENT '枚举值',
    PRIMARY KEY (id),
    KEY k_ep (event, property)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  ROW_FORMAT = COMPRESSED COMMENT ='元数据-事件属性枚举值表';




INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'uid', '用户标识', 'string', 1, 0);

INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'version', '当前版本', 'string', 1, 0);

INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'df', '当前渠道', 'string', 1, 0);

INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'imei', '用户设备标识信息', 'string', 1, 0);

INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'imsi', '用户SIM卡信息标识', 'string', 1, 0);

INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'ip', '远程IP', 'string', 1, 0);

INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'country', '国家', 'string', 1, 0);


INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'province', '省份', 'string', 1, 0);

INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'city', '城市', 'string', 1, 0);


INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'brand', '品牌', 'string', 1, 0);

INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'model', '机型', 'string', 1, 0);


INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'submodel', '子机型', 'string', 1, 0);


INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'os', '操作系统版本', 'string', 1, 0);


INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'resolution', '分辨率', 'string', 1, 0);

INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'starttime', '开始时间', 'string', 1, 0);

INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'endtime', '结束时间', 'string', 1, 0);

INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'ctm', '上传时间', 'string', 1, 0);


INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'bizid', '产品', 'string', 1, 0);

INSERT INTO flint.metadata_event_property
(event_name, name, show_name, `type`, display, sort)
VALUES('all', 'osid', '平台', 'string', 1, 0);
