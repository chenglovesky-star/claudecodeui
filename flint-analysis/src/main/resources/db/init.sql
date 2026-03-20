# 初始化任务

CREATE DATABASE if not EXISTS flint;

use flint;
-- flint.impala_query_history definition

CREATE TABLE `impala_query_history` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '查询id,用bigint类型防止32位整数溢出',
  `query_time` datetime NOT NULL COMMENT '用户发起查询的时间',
  `query_request` longtext NOT NULL COMMENT '查询条件',
  `query_sql` text NOT NULL COMMENT '查询语句',
  `username` varchar(30) NOT NULL COMMENT '发起查询的用户名',
  `status` int NOT NULL COMMENT '查询状态, QueryHistoryStatusEnum',
  `start_time` timestamp NULL DEFAULT NULL COMMENT '开始时间',
  `end_time` timestamp NULL DEFAULT NULL COMMENT '结束时间',
  `period` bigint DEFAULT '0' COMMENT '查询时长',
  `message` longtext COMMENT '查询信息',
  PRIMARY KEY (`id`),
  KEY `idx_user_query_time` (`username`,`query_time`)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8mb4  ROW_FORMAT=COMPRESSED COMMENT='事件查询历史记录表';


-- flint.impala_query_result definition

CREATE TABLE `impala_query_result` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '结果ID,用bigint类型防止32位整数溢出',
  `history_id` bigint NOT NULL COMMENT '查询历史ID',
  `query_sql` text NOT NULL COMMENT '查询语句',
  `origin_result` longtext NOT NULL COMMENT '查询结果原始内容',
  PRIMARY KEY (`id`),
  UNIQUE KEY `history` (`history_id`)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8mb4  ROW_FORMAT=COMPRESSED COMMENT='事件查询结果记录表';


-- flint.k_dim definition

CREATE TABLE `k_dim` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `name` varchar(128) NOT NULL COMMENT '维度名称',
  `hive_table_name` varchar(64) NOT NULL COMMENT '维度表',
  `dim_column` varchar(128) NOT NULL COMMENT '维度字段',
  `event` varchar(64) NOT NULL COMMENT '事件',
  `property` varchar(128) NOT NULL COMMENT '映射属性',
  `username` varchar(30) NOT NULL COMMENT '创建人',
  `status` int NOT NULL COMMENT '维表状态',
  `create_time` timestamp NOT NULL COMMENT '创建时间',
  `update_time` timestamp NOT NULL COMMENT '编辑时间',
  `partition` varchar(64) DEFAULT '' COMMENT '分区属性',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_n` (`name`),
  UNIQUE KEY `uniq_t` (`hive_table_name`,`event`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4  ROW_FORMAT=COMPRESSED COMMENT='维表';


-- flint.k_dim_column definition

CREATE TABLE `k_dim_column` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `dim_id` int NOT NULL COMMENT '维度表ID',
  `name` varchar(128) NOT NULL DEFAULT '' COMMENT '维表属性名称',
  `show_name` varchar(128) NOT NULL DEFAULT '' COMMENT '维表属性显示名称',
  `type` varchar(32) NOT NULL DEFAULT '' COMMENT '维表属性类型',
  `display` int NOT NULL DEFAULT '1' COMMENT '维表字段是否显示',
  PRIMARY KEY (`id`),
  KEY `idx_dim_id` (`dim_id`)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8mb4  ROW_FORMAT=COMPRESSED COMMENT='维表列';


-- flint.metadata_event definition

CREATE TABLE `metadata_event` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '结果ID,用bigint类型防止32位整数溢出',
  `name` varchar(128) NOT NULL DEFAULT '' COMMENT '事件名称',
  `show_name` varchar(128) NOT NULL DEFAULT '' COMMENT '事件展示名称',
  `description` varchar(1024) DEFAULT '' COMMENT '事件描述',
  `tags` varchar(128) DEFAULT '' COMMENT '事件标签',
  `display` int NOT NULL DEFAULT '1' COMMENT '是否显示',
  `modules` varchar(64) DEFAULT '' COMMENT '业务线标示',
  `sort` int DEFAULT '0' COMMENT '排序值',
  `priority` int DEFAULT '0' COMMENT '优先级',
  PRIMARY KEY (`id`),
  UNIQUE KEY `u_name` (`name`)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8mb4  ROW_FORMAT=COMPRESSED COMMENT='元数据-事件表';


-- flint.metadata_event_property definition

CREATE TABLE `metadata_event_property` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '结果ID,用bigint类型防止32位整数溢出',
  `event_name` varchar(128) NOT NULL DEFAULT '' COMMENT '事件名称',
  `name` varchar(128) NOT NULL DEFAULT '' COMMENT '属性名称',
  `show_name` varchar(128) NOT NULL DEFAULT '' COMMENT '属性显示名称',
  `type` varchar(32) NOT NULL DEFAULT '' COMMENT '属性类型',
  `display` int NOT NULL DEFAULT '1' COMMENT '是否显示',
  `sort` int DEFAULT '0' COMMENT '排序值',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8mb4  ROW_FORMAT=COMPRESSED COMMENT='元数据-事件属性表';


-- flint.metadata_event_property_value definition

CREATE TABLE `metadata_event_property_value` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '结果ID,用bigint类型防止32位整数溢出',
  `event` varchar(128) NOT NULL DEFAULT '' COMMENT '事件名称',
  `property` varchar(255) NOT NULL DEFAULT '' COMMENT '属性名称',
  `value` longtext NOT NULL COMMENT '枚举值',
  PRIMARY KEY (`id`),
  KEY `k_ep` (`event`,`property`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4  ROW_FORMAT=COMPRESSED COMMENT='元数据-事件属性枚举值表';


-- flint.metadata_profile_category definition

CREATE TABLE `metadata_profile_category` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '结果ID,用bigint类型防止32位整数溢出',
  `name` varchar(128) NOT NULL DEFAULT '' COMMENT '事件名称',
  `show_name` varchar(128) NOT NULL DEFAULT '' COMMENT '事件展示名称',
  `display` int NOT NULL DEFAULT '1' COMMENT '是否显示',
  PRIMARY KEY (`id`),
  UNIQUE KEY `u_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4  ROW_FORMAT=COMPRESSED COMMENT='元数据-画像分类';


-- flint.metadata_profile_column definition

CREATE TABLE `metadata_profile_column` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '结果ID,用bigint类型防止32位整数溢出',
  `category_id` int NOT NULL DEFAULT '0' COMMENT '画像属性分类ID',
  `name` varchar(128) NOT NULL DEFAULT '' COMMENT '画像属性名称',
  `show_name` varchar(128) NOT NULL DEFAULT '' COMMENT '画像属性显示名称',
  `type` varchar(32) NOT NULL DEFAULT '' COMMENT '画像属性类型',
  `display` int NOT NULL DEFAULT '1' COMMENT '是否显示',
  `enum_values` varchar(1024) DEFAULT '' COMMENT '枚举值',
  PRIMARY KEY (`id`),
  UNIQUE KEY `u_name` (`name`)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8mb4  ROW_FORMAT=COMPRESSED COMMENT='元数据-画像属性表';


-- flint.operation definition

CREATE TABLE `operation` (
  `id` int unsigned NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `name` varchar(64) NOT NULL COMMENT '比较类型名称',
  `description` varchar(255) DEFAULT NULL COMMENT '描述',
  `select_type` int NOT NULL DEFAULT '0' COMMENT '参数选择类型，0-无输入框 1-1输入/单选框 2-2输入框 3-1多选/输入框 4-1输入日期框 5-2输入日期框 6-1输入框',
  `column_type` int NOT NULL DEFAULT '0' COMMENT '列值类型，0-整型 1-浮点型 2-字符串 3-数组 4-map 5-日期 6-Boolean',
  `query_template` varchar(255) DEFAULT NULL COMMENT '查询模板',
  `status` int NOT NULL DEFAULT '0' COMMENT '状态：0有效，-1失效',
  `created` timestamp NULL DEFAULT NULL COMMENT '创建时间',
  `created_by` varchar(64) NOT NULL COMMENT '创建人',
  `updated` timestamp NULL DEFAULT NULL COMMENT '修改时间',
  `updated_by` varchar(64) DEFAULT NULL COMMENT '修改人',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_name_column` (`name`,`column_type`)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8mb3 COMMENT='比较类型表';


-- flint.shedlock definition

CREATE TABLE `shedlock` (
  `name` varchar(64) NOT NULL,
  `lock_until` timestamp(3) NULL DEFAULT NULL,
  `locked_at` timestamp(3) NULL DEFAULT NULL,
  `locked_by` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ;


-- flint.virtual_event definition

CREATE TABLE `virtual_event` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '结果ID,用bigint类型防止32位整数溢出',
  `name` varchar(128) NOT NULL DEFAULT '' COMMENT '虚拟事件名称',
  `display_name` varchar(255) NOT NULL DEFAULT '' COMMENT '显示名称',
  `description` varchar(255) DEFAULT '' COMMENT '描述',
  `tags` varchar(1024) DEFAULT NULL COMMENT '标签',
  `event_filter` longtext COMMENT '事件过滤',
  `event_sql` text COMMENT '事件解析sql',
  `add_user` varchar(64) DEFAULT '' COMMENT '添加人',
  `add_time` timestamp NULL DEFAULT NULL COMMENT '添加时间',
  `display` int NOT NULL DEFAULT '1' COMMENT '是否显示',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4  ROW_FORMAT=COMPRESSED COMMENT='虚拟事件表';

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
       (43, 'Equal', '等于', 1, 6, NULL, 0, '2024-09-11 03:04:00', 'linlong', '2024-09-11 03:04:00', 'linlong');



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
