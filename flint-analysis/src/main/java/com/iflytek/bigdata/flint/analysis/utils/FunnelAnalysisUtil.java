package com.iflytek.bigdata.flint.analysis.utils;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.google.common.base.Joiner;
import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryHistory;
import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryHistoryWithBLOBs;
import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryResultWithBLOBs;
import com.iflytek.bigdata.flint.analysis.dto.*;
import com.iflytek.bigdata.flint.analysis.service.IImpalaQueryHistoryService;
import com.iflytek.bigdata.flint.analysis.service.IImpalaQueryResultService;
import com.iflytek.bigdata.flint.analysis.thread.AnalysisQueryStatusEnum;
import com.iflytek.bigdata.flint.analysis.thread.AnalysisQueryTask;
import com.iflytek.bigdata.flint.common.date.DateStyle;
import com.iflytek.bigdata.flint.common.date.DateUtil;
import com.iflytek.bigdata.flint.hiveserver2.config.AnalysisConfig;
import com.iflytek.bigdata.flint.hiveserver2.config.HiveConfig;
import com.iflytek.bigdata.flint.metadata.dao.model.*;
import com.iflytek.bigdata.flint.metadata.dto.*;
import com.iflytek.bigdata.flint.metadata.service.*;
import com.iflytek.bigdata.flint.metadata.utils.MetadataUtil;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.DigestUtils;

import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * 漏斗分析工具类 - 重构版本，复用 AnalysisUtil 的核心逻辑
 */
@Component
@Slf4j
public class FunnelAnalysisUtil {

    @Autowired
    private AnalysisUtil analysisUtil;

    @Autowired
    private IImpalaQueryHistoryService iImpalaQueryHistoryService;

    @Autowired
    private IImpalaQueryResultService iImpalaQueryResultService;

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    @Autowired
    private AnalysisConfig analysisConfig;

    @Autowired
    private HiveConfig hiveConfig;

    @Autowired
    private MetadataUtil metadataUtil;

    @Autowired
    private IDimService iDimService;

    @Autowired
    private IDimColumnService iDimColumnService;

    @Autowired
    private IMetadataProfileColumnService iMetadataProfileColumnService;

    @Autowired
    private IMetadataEventPropertyService iMetadataEventPropertyService;

    @Autowired
    private IVirtualEventService iVirtualEventService;

    @Autowired
    private IOperationService iOperationService;
    
    @Value("${hive.engine:STARROCKS}")
    private String hiveEngine;

    private static final String CACHE_KEY = "funnel_analysis_cache_";
    private static final String STARROCKS = "STARROCKS";
    private static final String ALL = "all";
    private static final String ALL_CN = "全部";
    private static final String GROUP_IDS_COLUMN = "group_ids";

    /**
     * 生成漏斗分析SQL - 复用 AnalysisUtil 的逻辑
     */
    public String generateFunnelAnalysisSql(FunnelAnalysisDto funnelAnalysisDto) {
        List<FunnelStepDto> steps = funnelAnalysisDto.getFunnelSteps();
        if (CollectionUtils.isEmpty(steps)) {
            throw new RuntimeException("漏斗步骤不能为空");
        }

        // 复用 AnalysisUtil 的时间处理逻辑
        String times = funnelAnalysisDto.getTimeValues();
        String[] timeArr = times.split(",");
        String startDate = DateUtil.StringToString(timeArr[0], DateStyle.YYYY_MM_DD, DateStyle.YYYYMMDD);
        String endDate = DateUtil.StringToString(timeArr[1], DateStyle.YYYY_MM_DD, DateStyle.YYYYMMDD);

        // 构建基础查询条件
        String dateCondition = String.format(" proc_date >= '%s' AND proc_date <= '%s' ", startDate, endDate);
        
        // 构建每个步骤的子查询 - 复用 AnalysisUtil 的事件处理逻辑
        List<String> stepQueries = new ArrayList<>();
        for (int i = 0; i < steps.size(); i++) {
            FunnelStepDto step = steps.get(i);
            String stepQuery = buildStepQueryUsingAnalysisUtil(step, i + 1, dateCondition, funnelAnalysisDto);
            stepQueries.add(stepQuery);
        }

        // 构建最终的漏斗分析SQL
        return buildFunnelSql(stepQueries, funnelAnalysisDto);
    }

    /**
     * 使用 AnalysisUtil 构建单个步骤的查询SQL
     */
    private String buildStepQueryUsingAnalysisUtil(FunnelStepDto step, int stepNumber, String dateCondition, FunnelAnalysisDto funnelAnalysisDto) {
        // 将漏斗步骤转换为事件分析参数，复用 AnalysisUtil 的逻辑
        EventDetailDto eventDetail = convertStepToEventDetail(step, funnelAnalysisDto);
        
        // 直接使用 AnalysisUtil 的 createQuery 方法来创建查询
        // 但我们需要获取生成的SQL，所以我们需要另一种方式
        
        // 由于无法直接访问私有方法，我们需要自己实现SQL生成逻辑
        // 但可以复用 AnalysisUtil 中的一些公共方法和逻辑
        return buildStepQueryDirectly(step, stepNumber, dateCondition, funnelAnalysisDto);
    }

    /**
     * 直接构建步骤查询SQL，复用 AnalysisUtil 中的逻辑模式
     */
    private String buildStepQueryDirectly(FunnelStepDto step, int stepNumber, String dateCondition, FunnelAnalysisDto funnelAnalysisDto) {
        // 检测实验分组
        String expGroupId = "";
        boolean isExp = false;
        
        // 检查步骤筛选条件中的实验分组
        if (step.getFilter() != null && CollectionUtils.isNotEmpty(step.getFilter().getSubFilters())) {
            for (EventPropertyDto property : step.getFilter().getSubFilters()) {
                if ("U|expinfo".equals(property.getPropertyName()) && StringUtils.isNotEmpty(property.getPropertyOperationValue())) {
                    expGroupId = property.getPropertyOperationValue();
                    isExp = true;
                    break;
                }
            }
        }
        
        // 检查全局筛选条件中的实验分组
        if (!isExp && funnelAnalysisDto.getGlobalFilter() != null && CollectionUtils.isNotEmpty(funnelAnalysisDto.getGlobalFilter().getSubFilters())) {
            for (EventPropertyDto property : funnelAnalysisDto.getGlobalFilter().getSubFilters()) {
                if ("U|expinfo".equals(property.getPropertyName()) && StringUtils.isNotEmpty(property.getPropertyOperationValue())) {
                    expGroupId = property.getPropertyOperationValue();
                    isExp = true;
                    break;
                }
            }
        }
        
        log.info("实验分组检测 - isExp: {}, expGroupId: {}", isExp, expGroupId);
        
        // 检测是否需要JOIN用户表
        boolean needJoinUser = checkNeedJoinUser(step, funnelAnalysisDto);
        List<String> userColumns = new ArrayList<>();
        
        if (needJoinUser) {
            userColumns = collectUserColumns(step, funnelAnalysisDto);
        }
        
        StringBuilder sql = new StringBuilder();
        
        // 构建基础查询
        if (needJoinUser && CollectionUtils.isNotEmpty(userColumns)) {
            // 需要JOIN用户表的情况
            sql.append("SELECT DISTINCT events.uid, events.starttime, ")
               .append(stepNumber).append(" as step_number, '")
               .append(stepNumber).append("' as step_name");
            
            // 添加用户属性列
            for (String userColumn : userColumns) {
                sql.append(", events.").append(userColumn);
            }
            
            sql.append(" FROM (");
            
            // 构建事件表子查询
            sql.append("SELECT ").append(buildEventSelectColumns(userColumns))
               .append(" FROM ").append(analysisConfig.getEventsTable())
               .append(" WHERE 1=1 AND ").append(dateCondition);
            
            // 添加事件名称条件
            addEventNameCondition(sql, step);
            
            // 添加事件属性过滤
            addEventFilterConditions(sql, step, userColumns);
            
            // 添加全局过滤条件
            addGlobalFilterConditions(sql, funnelAnalysisDto, userColumns);
            
            sql.append(") events");
            
            // JOIN用户画像表或AB实验表
            if (isExp) {
                // 特殊处理AB实验
                sql.append(" JOIN (");
                sql.append("SELECT DISTINCT uid, proc_date");
                if (CollectionUtils.isNotEmpty(userColumns)) {
                    // 处理实验分组的特殊列名映射
                    List<String> formatUserColumns = new ArrayList<>();
                    for (String userColumn : userColumns) {
                        if ("expinfo".equals(userColumn)) {
                            formatUserColumns.add("groupid as expinfo");
                        } else {
                            formatUserColumns.add(userColumn);
                        }
                    }
                    sql.append(", ").append(Joiner.on(", ").join(formatUserColumns));
                }
                sql.append(" FROM ").append(analysisConfig.getAbtestTable())
                   .append(" WHERE expid = ").append(expGroupId).append(" AND ").append(dateCondition)
                   .append(") u ON events.uid = u.uid AND events.proc_date = u.proc_date");
            } else {
                // 普通用户画像表JOIN
                sql.append(" JOIN (");
                sql.append("SELECT uid, proc_date");
                if (CollectionUtils.isNotEmpty(userColumns)) {
                    sql.append(", ").append(Joiner.on(", ").join(userColumns));
                }
                sql.append(" FROM ").append(analysisConfig.getProfileTable())
                   .append(") u ON events.uid = u.uid AND events.proc_date = u.proc_date");
            }
            
        } else {
            // 不需要JOIN用户表的情况
            sql.append("SELECT DISTINCT uid, starttime, ")
               .append(stepNumber).append(" as step_number, '")
               .append(stepNumber).append("' as step_name ")
               .append("FROM ").append(analysisConfig.getEventsTable())
               .append(" WHERE 1=1 AND ").append(dateCondition);
            
            // 添加事件名称条件
            addEventNameCondition(sql, step);
            
            // 添加事件属性过滤
            addEventFilterConditions(sql, step, new ArrayList<>());
            
            // 添加全局过滤条件
            addGlobalFilterConditions(sql, funnelAnalysisDto, new ArrayList<>());
        }
        
        return sql.toString();
    }
    
    /**
     * 检测是否需要JOIN用户表
     */
    private boolean checkNeedJoinUser(FunnelStepDto step, FunnelAnalysisDto funnelAnalysisDto) {
        // 检查步骤筛选条件中的用户属性
        if (step.getFilter() != null && CollectionUtils.isNotEmpty(step.getFilter().getSubFilters())) {
            for (EventPropertyDto property : step.getFilter().getSubFilters()) {
                if (property.getPropertyName().startsWith("U|")) {
                    return true;
                }
            }
        }
        
        // 检查全局筛选条件中的用户属性
        if (funnelAnalysisDto.getGlobalFilter() != null && CollectionUtils.isNotEmpty(funnelAnalysisDto.getGlobalFilter().getSubFilters())) {
            for (EventPropertyDto property : funnelAnalysisDto.getGlobalFilter().getSubFilters()) {
                if (property.getPropertyName().startsWith("U|")) {
                    return true;
                }
            }
        }
        
        // 检查分组字段中的用户属性
        if (CollectionUtils.isNotEmpty(funnelAnalysisDto.getGroupBy())) {
            for (String groupField : funnelAnalysisDto.getGroupBy()) {
                if (groupField.startsWith("U|")) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    /**
     * 收集用户属性列
     */
    private List<String> collectUserColumns(FunnelStepDto step, FunnelAnalysisDto funnelAnalysisDto) {
        Set<String> userColumns = new HashSet<>();
        
        // 收集步骤筛选条件中的用户属性
        if (step.getFilter() != null && CollectionUtils.isNotEmpty(step.getFilter().getSubFilters())) {
            for (EventPropertyDto property : step.getFilter().getSubFilters()) {
                if (property.getPropertyName().startsWith("U|")) {
                    String userColumn = getUserColumnName(property.getPropertyName());
                    if (StringUtils.isNotEmpty(userColumn)) {
                        userColumns.add(userColumn);
                    }
                }
            }
        }
        
        // 收集全局筛选条件中的用户属性
        if (funnelAnalysisDto.getGlobalFilter() != null && CollectionUtils.isNotEmpty(funnelAnalysisDto.getGlobalFilter().getSubFilters())) {
            for (EventPropertyDto property : funnelAnalysisDto.getGlobalFilter().getSubFilters()) {
                if (property.getPropertyName().startsWith("U|")) {
                    String userColumn = getUserColumnName(property.getPropertyName());
                    if (StringUtils.isNotEmpty(userColumn)) {
                        userColumns.add(userColumn);
                    }
                }
            }
        }
        
        // 收集分组字段中的用户属性
        if (CollectionUtils.isNotEmpty(funnelAnalysisDto.getGroupBy())) {
            for (String groupField : funnelAnalysisDto.getGroupBy()) {
                if (groupField.startsWith("U|")) {
                    String userColumn = getUserColumnName(groupField);
                    if (StringUtils.isNotEmpty(userColumn)) {
                        userColumns.add(userColumn);
                    }
                }
            }
        }
        
        return new ArrayList<>(userColumns);
    }
    
    /**
     * 获取用户属性列名
     */
    private String getUserColumnName(String propertyName) {
        if (!propertyName.startsWith("U|")) {
            return "";
        }
        
        String profileColumn = propertyName.substring(2);
        
        // 特殊处理AB实验
        if ("expinfo".equals(profileColumn)) {
            return "expinfo"; // 在JOIN时会映射为 groupid as expinfo
        }
        
        // 处理临时标签
        if (profileColumn.startsWith("temp_tags")) {
            return "temp_tags";
        }
        
        // 查询用户画像列信息
        try {
            MetadataProfileColumn metadataProfileColumn = iMetadataProfileColumnService.selectByName(profileColumn);
            if (metadataProfileColumn != null) {
                return profileColumn;
            }
        } catch (Exception e) {
            log.warn("查询用户画像列失败: {}", profileColumn, e);
        }
        
        return profileColumn;
    }
    
    /**
     * 构建事件表选择列
     */
    private String buildEventSelectColumns(List<String> userColumns) {
        List<String> columns = new ArrayList<>();
        columns.add("uid");
        columns.add("starttime");
        columns.add("proc_date");
        columns.add("opcode");
        columns.add("tags"); // 确保包含tags列，用于新用户判断等特殊属性
        
        return Joiner.on(", ").join(columns);
    }
    
    /**
     * 添加事件名称条件
     */
    private void addEventNameCondition(StringBuilder sql, FunnelStepDto step) {
        if (StringUtils.isNotEmpty(step.getEventName()) && !ALL.equals(step.getEventName())) {
            if (step.getEventName().startsWith("V|")) {
                // 虚拟事件处理
                String virtualEventSql = getVirtualEventSql(step.getEventName());
                if (StringUtils.isNotEmpty(virtualEventSql)) {
                    sql.append(" AND (").append(virtualEventSql).append(")");
                }
            } else {
                sql.append(" AND opcode = '").append(step.getEventName()).append("'");
            }
        }
    }
    
    /**
     * 添加事件过滤条件
     */
    private void addEventFilterConditions(StringBuilder sql, FunnelStepDto step, List<String> userColumns) {
        if (step.getFilter() != null && CollectionUtils.isNotEmpty(step.getFilter().getSubFilters())) {
            String filterSql = buildEventFilterSql(step.getFilter());
            if (StringUtils.isNotEmpty(filterSql)) {
                sql.append(" AND (").append(filterSql).append(")");
            }
        }
    }
    
    /**
     * 添加全局过滤条件
     */
    private void addGlobalFilterConditions(StringBuilder sql, FunnelAnalysisDto funnelAnalysisDto, List<String> userColumns) {
        if (funnelAnalysisDto.getGlobalFilter() != null) {
            String globalFilterSql = buildGlobalFilterSql(funnelAnalysisDto.getGlobalFilter());
            if (StringUtils.isNotEmpty(globalFilterSql)) {
                sql.append(" AND (").append(globalFilterSql).append(")");
            }
        }
    }

    /**
     * 获取虚拟事件SQL - 复用 AnalysisUtil 的逻辑
     */
    private String getVirtualEventSql(String virtualEventName) {
        if (!virtualEventName.startsWith("V|")) {
            return "";
        }
        
        String eventName = virtualEventName.substring(2);
        VirtualEventWithBLOBs virtualEvent = iVirtualEventService.selectByName(eventName);
        if (virtualEvent != null) {
            return virtualEvent.getEventSql();
        }
        return "";
    }

    /**
     * 构建事件过滤条件SQL - 复用 AnalysisUtil 的逻辑
     */
    private String buildEventFilterSql(PropertyFilterDto filter) {
        if (filter == null || CollectionUtils.isEmpty(filter.getSubFilters())) {
            return "";
        }

        List<String> conditions = new ArrayList<>();
        for (EventPropertyDto property : filter.getSubFilters()) {
            String condition = buildPropertyCondition(property);
            if (StringUtils.isNotEmpty(condition)) {
                conditions.add(condition);
            }
        }

        if (CollectionUtils.isNotEmpty(conditions)) {
            return Joiner.on(" " + filter.getRelation() + " ").join(conditions);
        }
        return "";
    }

    /**
     * 构建属性条件 - 复用 AnalysisUtil 的逻辑
     */
    private String buildPropertyCondition(EventPropertyDto property) {
        if (property == null) {
            return "";
        }
        
        String propertyName = property.getPropertyName();
        String operationValue = property.getPropertyOperationValue();
        Integer operationId = property.getPropertyOperationId();
        
        log.info("=== 构建属性条件开始 ===");
        log.info("属性名: {}, 操作值: {}, 操作ID: {}", propertyName, operationValue, operationId);
        
        String column = getColumnName(propertyName);
        log.info("解析后的列名: {}", column);
        
        // 根据操作类型构建条件 - 使用 MetadataUtil 的方法确保一致性
        if (operationId != null) {
            Operation operation = iOperationService.selectById(operationId);
            if (operation != null) {
                log.info("查询到的操作信息:");
                log.info("  - ID: {}", operation.getId());
                log.info("  - 名称: {}", operation.getName());
                log.info("  - 描述: {}", operation.getDescription());
                log.info("  - 列类型: {}", operation.getColumnType());
                log.info("  - 查询模板: {}", operation.getQueryTemplate());
                
                // 构建 ConditionDto 对象，复用 MetadataUtil 的逻辑
                ConditionDto conditionDto = new ConditionDto();
                conditionDto.setColumnName(column);
                conditionDto.setOperationName(operation.getName());
                conditionDto.setOperationValue(operationValue);
                conditionDto.setColumnType(operation.getColumnType());
                
                log.info("构建的ConditionDto:");
                log.info("  - 列名: {}", conditionDto.getColumnName());
                log.info("  - 操作名: {}", conditionDto.getOperationName());
                log.info("  - 操作值: {}", conditionDto.getOperationValue());
                log.info("  - 列类型: {}", conditionDto.getColumnType());
                
                // 使用 MetadataUtil 的 getSql 方法生成SQL条件
                String sql = metadataUtil.getSql(conditionDto);
                log.info("生成的SQL条件: {}", sql);
                log.info("=== 构建属性条件结束 ===");
                return sql;
            } else {
                log.warn("未找到操作ID为 {} 的操作记录", operationId);
            }
        } else {
            log.warn("操作ID为空，使用默认等于条件");
        }
        
        // 默认等于条件
        String defaultSql = column + " = '" + operationValue + "'";
        log.info("使用默认等于条件: {}", defaultSql);
        log.info("=== 构建属性条件结束 ===");
        return defaultSql;
    }

    /**
     * 构建全局筛选条件SQL
     */
    private String buildGlobalFilterSql(PropertyFilterDto globalFilter) {
        if (globalFilter == null || CollectionUtils.isEmpty(globalFilter.getSubFilters())) {
            return "";
        }
        
        List<String> filterSqls = new ArrayList<>();
        for (EventPropertyDto subFilter : globalFilter.getSubFilters()) {
            String condition = buildPropertyCondition(subFilter);
            if (StringUtils.isNotEmpty(condition)) {
                filterSqls.add(condition);
            }
        }
        
        if (CollectionUtils.isNotEmpty(filterSqls)) {
            return Joiner.on(" " + globalFilter.getRelation() + " ").join(filterSqls);
        }
        return "";
    }

    /**
     * 构建最终的漏斗分析SQL
     */
    private String buildFunnelSql(List<String> stepQueries, FunnelAnalysisDto funnelAnalysisDto) {
        StringBuilder sql = new StringBuilder();
        
        // 使用CTE构建漏斗分析
        sql.append("WITH ");
        
        // 为每个步骤创建CTE
        for (int i = 0; i < stepQueries.size(); i++) {
            if (i > 0) sql.append(", ");
            sql.append("step_").append(i + 1).append(" AS (")
               .append(stepQueries.get(i))
               .append(")");
        }

        // 构建漏斗主查询
        sql.append(" SELECT ");
        
        // 分组字段处理 - 复用 AnalysisUtil 的逻辑
        List<String> groupByFields = funnelAnalysisDto.getGroupBy();
        if (CollectionUtils.isNotEmpty(groupByFields) && !groupByFields.contains(ALL)) {
            String groupBySelect = buildGroupBySelect(groupByFields);
            if (StringUtils.isNotEmpty(groupBySelect)) {
                sql.append(groupBySelect).append(", ");
            }
        }

        // 时间维度处理 - 复用 AnalysisUtil 的逻辑
        String timeFormat = getTimeFormat(funnelAnalysisDto.getTimeBucket());
        sql.append(timeFormat).append(" as time_bucket, ");

        // 各步骤的用户数统计
        for (int i = 1; i <= stepQueries.size(); i++) {
            sql.append("COUNT(DISTINCT CASE WHEN step").append(i).append(".uid IS NOT NULL THEN step1.uid END) as step_").append(i).append("_count");
            if (i < stepQueries.size()) sql.append(", ");
        }

        // FROM子句 - 以第一步为基础，LEFT JOIN其他步骤
        sql.append(" FROM step_1");
        for (int i = 2; i <= stepQueries.size(); i++) {
            sql.append(" LEFT JOIN step_").append(i)
               .append(" ON step_1.uid = step_").append(i).append(".uid")
               .append(" AND step_1.starttime <= step_").append(i).append(".starttime");
            
            // 添加时间窗口限制
            if (funnelAnalysisDto.getWindowPeriod() != null && funnelAnalysisDto.getWindowPeriod() > 0) {
                sql.append(" AND step_").append(i).append(".starttime <= step_1.starttime + INTERVAL ")
                   .append(funnelAnalysisDto.getWindowPeriod()).append(" DAY");
            }
        }

        // GROUP BY子句
        sql.append(" GROUP BY ");
        if (CollectionUtils.isNotEmpty(groupByFields) && !groupByFields.contains(ALL)) {
            String groupByClause = buildGroupByClause(groupByFields);
            if (StringUtils.isNotEmpty(groupByClause)) {
                sql.append(groupByClause).append(", ");
            }
        }
        sql.append(timeFormat);

        // ORDER BY子句
        sql.append(" ORDER BY time_bucket");
        if (CollectionUtils.isNotEmpty(groupByFields) && !groupByFields.contains(ALL)) {
            sql.append(", ").append(buildGroupByClause(groupByFields));
        }

        return sql.toString();
    }

    /**
     * 构建分组查询的SELECT部分 - 复用 AnalysisUtil 的逻辑
     */
    private String buildGroupBySelect(List<String> groupByFields) {
        List<String> selectFields = new ArrayList<>();
        for (String field : groupByFields) {
            String selectField = buildGroupBySelectField(field);
            if (StringUtils.isNotEmpty(selectField)) {
                selectFields.add(selectField);
            }
        }
        return Joiner.on(", ").join(selectFields);
    }

    /**
     * 构建单个分组字段的SELECT部分 - 复用 AnalysisUtil 的逻辑
     */
    private String buildGroupBySelectField(String field) {
        if (field.startsWith("C|")) {
            String commonColumn = field.substring(2);
            
            // 特殊处理新用户判断
            if ("d_newflag".equals(commonColumn)) {
                return "ifly_map_get(tags,'" + commonColumn + "') as `" + field + "`";
            }
            
            if (commonPros().contains(commonColumn)) {
                return commonColumn;
            } else {
                return "ifly_map_get(tags,'" + commonColumn + "') as `" + field + "`";
            }
        } else if (field.startsWith("U|")) {
            String profileColumn = field.substring(2);
            return profileColumn;
        } else if (field.startsWith("D|")) {
            return "dim_column";
        } else {
            return "ifly_map_get(tags,'" + field + "') as `" + field + "`";
        }
    }

    /**
     * 构建分组查询的GROUP BY部分 - 复用 AnalysisUtil 的逻辑
     */
    private String buildGroupByClause(List<String> groupByFields) {
        List<String> groupByColumns = new ArrayList<>();
        for (String field : groupByFields) {
            String groupByColumn = buildGroupByColumn(field);
            if (StringUtils.isNotEmpty(groupByColumn)) {
                groupByColumns.add(groupByColumn);
            }
        }
        return Joiner.on(", ").join(groupByColumns);
    }

    /**
     * 构建单个分组字段的GROUP BY列 - 复用 AnalysisUtil 的逻辑
     */
    private String buildGroupByColumn(String field) {
        if (field.startsWith("C|")) {
            String commonColumn = field.substring(2);
            
            // 特殊处理新用户判断
            if ("d_newflag".equals(commonColumn)) {
                return "ifly_map_get(tags,'" + commonColumn + "')";
            }
            
            if (commonPros().contains(commonColumn)) {
                return commonColumn;
            } else {
                return "ifly_map_get(tags,'" + commonColumn + "')";
            }
        } else if (field.startsWith("U|")) {
            String profileColumn = field.substring(2);
            return profileColumn;
        } else if (field.startsWith("D|")) {
            return "dim_column";
        } else {
            return "ifly_map_get(tags,'" + field + "')";
        }
    }

    /**
     * 获取时间格式 - 复用 AnalysisUtil 的逻辑
     */
    private String getTimeFormat(Integer timeBucket) {
        if (timeBucket == null) return "proc_date";
        
        switch (timeBucket) {
            case 0: return "proc_date"; // 按天
            case 1: return "from_timestamp(starttime,'yyyy-MM-dd HH')"; // 按小时
            case 2: return "from_timestamp(starttime,'yyyy-MM-dd HH:mm')"; // 按分钟
            case 3: return "date_trunc('week', starttime)"; // 按周
            case 4: return "substr(proc_date,1,6)"; // 按月
            case 5: return "'累计'"; // 累计
            default: return "proc_date";
        }
    }

    /**
     * 获取公共属性列表 - 复用 AnalysisUtil 的逻辑
     */
    private Set<String> commonPros() {
        return metadataUtil.getCommonPros();
    }

    /**
     * 创建漏斗分析查询
     */
    public ImpalaQueryHistory createFunnelQuery(String operator, FunnelAnalysisDto funnelAnalysisDto, Integer cache) {
        String requestJson = JSONObject.toJSONString(funnelAnalysisDto);
        String engine = STARROCKS;

        String sql = generateFunnelAnalysisSql(funnelAnalysisDto);
        String md5SQL = DigestUtils.md5DigestAsHex(sql.getBytes(StandardCharsets.UTF_8));

        Date now = new Date();

        // 缓存处理逻辑 - 复用原有逻辑
        if (cache != 0) {
            Object cacheId = redisTemplate.opsForValue().get(CACHE_KEY + md5SQL);
            if (cacheId != null) {
                ImpalaQueryHistoryWithBLOBs cacheItem = iImpalaQueryHistoryService.selectById(Long.valueOf(cacheId.toString()));
                if (cacheItem != null && (cacheItem.getStatus() == AnalysisQueryStatusEnum.FINISHED.getIndex())) {
                    return createCachedQuery(operator, requestJson, sql, now, cacheItem);
                }
                if (cacheItem != null && (cacheItem.getStatus() == AnalysisQueryStatusEnum.RUNNING.getIndex())) {
                    return cacheItem;
                }
            }
        }

        // 创建新查询
        ImpalaQueryHistoryWithBLOBs item = new ImpalaQueryHistoryWithBLOBs();
        item.setUsername(operator);
        item.setQueryTime(now);
        item.setStartTime(now);
        item.setStatus(AnalysisQueryStatusEnum.RUNNING.getIndex());
        item.setQueryRequest(requestJson);
        item.setQuerySql(sql);
        iImpalaQueryHistoryService.insert(item);

        redisTemplate.opsForValue().set(CACHE_KEY + md5SQL, item.getId().toString(), 60, TimeUnit.MINUTES);

        // 创建查询结果记录
        ImpalaQueryResultWithBLOBs result = new ImpalaQueryResultWithBLOBs();
        result.setHistoryId(item.getId());
        result.setQuerySql(sql);
        result.setOriginResult("");
        iImpalaQueryResultService.insert(result);

        // 执行查询任务
        AnalysisQueryTask queryTask = new AnalysisQueryTask();
        queryTask.setQueryContent(sql);
        queryTask.setQueryHistoryId(item.getId());
        queryTask.setiImpalaQueryResultService(iImpalaQueryResultService);
        queryTask.setiImpalaQueryHistoryService(iImpalaQueryHistoryService);
        queryTask.setJdbcType(engine);
        queryTask.setHiveConfig(hiveConfig);
        queryTask.setHiveEngine(hiveEngine);

        queryTask.run();
        return item;
    }

    /**
     * 创建缓存查询记录
     */
    private ImpalaQueryHistory createCachedQuery(String operator, String requestJson, String sql, Date now, ImpalaQueryHistoryWithBLOBs cacheItem) {
        ImpalaQueryHistoryWithBLOBs item = new ImpalaQueryHistoryWithBLOBs();
        item.setUsername(operator);
        item.setQueryTime(now);
        item.setStartTime(now);
        item.setEndTime(now);
        item.setStatus(AnalysisQueryStatusEnum.FINISHED.getIndex());
        item.setQueryRequest(requestJson);
        item.setQuerySql(sql);
        iImpalaQueryHistoryService.insert(item);

        ImpalaQueryResultWithBLOBs result = iImpalaQueryResultService.selectByHistoryId(cacheItem.getId());
        result.setId(null);
        result.setHistoryId(item.getId());
        result.setQuerySql(sql);
        iImpalaQueryResultService.insert(result);
        return item;
    }

    /**
     * 根据查询历史ID获取漏斗分析结果
     */
    public FunnelResultDto getFunnelResultByHistoryId(Long historyId) {
        ImpalaQueryHistoryWithBLOBs queryHistory = iImpalaQueryHistoryService.selectById(historyId);
        ImpalaQueryResultWithBLOBs queryResult = iImpalaQueryResultService.selectByHistoryId(historyId);
        
        if (queryResult == null || StringUtils.isEmpty(queryResult.getOriginResult())) {
            return null;
        }

        FunnelAnalysisDto originalRequest = JSONObject.parseObject(queryHistory.getQueryRequest(), FunnelAnalysisDto.class);
        return parseFunnelResult(queryResult.getOriginResult(), originalRequest);
    }

    /**
     * 解析漏斗分析结果
     */
    private FunnelResultDto parseFunnelResult(String originResult, FunnelAnalysisDto originalRequest) {
        FunnelResultDto result = new FunnelResultDto();
        
        try {
            List<Map<String, Object>> rawData = JSONArray.parseObject(originResult, List.class);
            
            // 提取步骤名称
            List<String> stepNames = originalRequest.getFunnelSteps().stream()
                    .map(step -> StringUtils.isNotEmpty(step.getEventName()) ? step.getEventName() : step.getEventName())
                    .collect(Collectors.toList());
            result.setStepNames(stepNames);

            // 处理总体数据
            if (CollectionUtils.isNotEmpty(rawData)) {
                Map<String, Object> totalData = rawData.get(0);
                List<Long> stepValues = new ArrayList<>();
                List<Double> conversionRates = new ArrayList<>();
                
                Long firstStepValue = null;
                for (int i = 0; i < stepNames.size(); i++) {
                    String stepKey = "step_" + (i + 1) + "_count";
                    Long stepValue = getLongValue(totalData.get(stepKey));
                    stepValues.add(stepValue);
                    
                    if (i == 0) {
                        firstStepValue = stepValue;
                        conversionRates.add(1.0); // 第一步转化率为100%
                    } else {
                        double rate = firstStepValue != null && firstStepValue > 0 ? 
                                (double) stepValue / firstStepValue : 0.0;
                        conversionRates.add(rate);
                    }
                }
                
                result.setStepValues(stepValues);
                result.setConversionRates(conversionRates);
            }

            // 处理分组数据和时间序列数据
            processGroupAndTimeData(result, rawData, originalRequest);
            
        } catch (Exception e) {
            log.error("解析漏斗分析结果失败", e);
        }
        
        return result;
    }

    /**
     * 处理分组和时间维度数据
     */
    private void processGroupAndTimeData(FunnelResultDto result, List<Map<String, Object>> rawData, FunnelAnalysisDto originalRequest) {
        // 根据是否有分组字段来处理数据
        List<String> groupByFields = originalRequest.getGroupBy();
        boolean hasGroupBy = CollectionUtils.isNotEmpty(groupByFields) && !groupByFields.contains(ALL);
        
        if (hasGroupBy) {
            // 处理分组数据
            List<FunnelGroupResultDto> groupResults = new ArrayList<>();
            Map<String, List<Map<String, Object>>> groupedData = rawData.stream()
                    .collect(Collectors.groupingBy(this::extractGroupKey));
            
            for (Map.Entry<String, List<Map<String, Object>>> entry : groupedData.entrySet()) {
                FunnelGroupResultDto groupResult = new FunnelGroupResultDto();
                groupResult.setGroupValues(Arrays.asList(entry.getKey().split("#")));
                
                // 聚合该分组的数据
                List<Long> groupStepValues = aggregateGroupStepValues(entry.getValue(), result.getStepNames().size());
                groupResult.setStepValues(groupStepValues);
                
                // 计算转化率
                List<Double> groupConversionRates = calculateConversionRates(groupStepValues);
                groupResult.setConversionRates(groupConversionRates);
                
                groupResults.add(groupResult);
            }
            result.setGroupResults(groupResults);
        }
        
        // 处理时间序列数据
        if (originalRequest.getTimeBucket() != null && originalRequest.getTimeBucket() != 5) { // 5表示累计，不需要时间序列
            Set<String> timeSet = rawData.stream()
                    .map(data -> String.valueOf(data.get("time_bucket")))
                    .collect(Collectors.toSet());
            result.setTimeSeries(new ArrayList<>(timeSet));
        }
    }

    /**
     * 提取分组键
     */
    private String extractGroupKey(Map<String, Object> data) {
        // 这里需要根据实际的分组字段来提取键值
        // 简化处理，实际需要根据具体的分组字段来实现
        return "default_group";
    }

    /**
     * 聚合分组的步骤值
     */
    private List<Long> aggregateGroupStepValues(List<Map<String, Object>> groupData, int stepCount) {
        List<Long> stepValues = new ArrayList<>();
        for (int i = 0; i < stepCount; i++) {
            String stepKey = "step_" + (i + 1) + "_count";
            Long totalValue = groupData.stream()
                    .mapToLong(data -> getLongValue(data.get(stepKey)))
                    .sum();
            stepValues.add(totalValue);
        }
        return stepValues;
    }

    /**
     * 计算转化率
     */
    private List<Double> calculateConversionRates(List<Long> stepValues) {
        List<Double> conversionRates = new ArrayList<>();
        if (CollectionUtils.isEmpty(stepValues)) {
            return conversionRates;
        }
        
        Long firstStepValue = stepValues.get(0);
        for (int i = 0; i < stepValues.size(); i++) {
            if (i == 0) {
                conversionRates.add(1.0);
            } else {
                double rate = firstStepValue != null && firstStepValue > 0 ? 
                        (double) stepValues.get(i) / firstStepValue : 0.0;
                conversionRates.add(rate);
            }
        }
        return conversionRates;
    }

    /**
     * 安全地获取Long值
     */
    private Long getLongValue(Object value) {
        if (value == null) return 0L;
        if (value instanceof Long) return (Long) value;
        if (value instanceof Integer) return ((Integer) value).longValue();
        if (value instanceof String) {
            try {
                return Long.parseLong((String) value);
            } catch (NumberFormatException e) {
                return 0L;
            }
        }
        return 0L;
    }

    /**
     * 导出漏斗分析结果到CSV
     */
    public void exportFunnelAnalysisResult(HttpServletResponse response, Long id) {
        PrintWriter writer = null;
        try {
            response.setContentType("application/octet-stream;charset=utf-8");
            String headerValue = String.format("attachment; filename=\"漏斗分析结果-%s.csv\"", id.toString());
            response.setHeader("Content-Disposition", headerValue);
            response.setCharacterEncoding("UTF-8");
            
            writer = response.getWriter();
            getFunnelCsvContent(writer, id);
            writer.flush();
        } catch (IOException e) {
            log.error("导出漏斗分析结果失败", e);
        } finally {
            if (writer != null) writer.close();
            try {
                response.flushBuffer();
            } catch (IOException e) {
                log.error("关闭响应输出流失败", e);
            }
        }
    }

    /**
     * 生成漏斗分析结果的CSV内容
     */
    private void getFunnelCsvContent(PrintWriter writer, Long id) {
        FunnelResultDto resultDto = getFunnelResultByHistoryId(id);
        if (resultDto == null) {
            writer.println("查询结果为空");
            return;
        }

        // 写入总体漏斗数据
        writer.println("=== 总体漏斗数据 ===");
        StringBuffer header = new StringBuffer("步骤名称,人数/次数,转化率");
        writer.println(header);
        
        if (resultDto.getStepNames() != null && resultDto.getStepValues() != null && resultDto.getConversionRates() != null) {
            for (int i = 0; i < resultDto.getStepNames().size(); i++) {
                StringBuffer line = new StringBuffer();
                String stepName = resultDto.getStepNames().get(i);
                Long stepValue = resultDto.getStepValues().get(i);
                Double conversionRate = resultDto.getConversionRates().get(i);
                
                line.append(escapeCsvField(stepName)).append(",");
                line.append(stepValue != null ? stepValue : 0).append(",");
                line.append(conversionRate != null ? String.format("%.2f%%", conversionRate * 100) : "0.00%");
                writer.println(line);
            }
        }

        // 写入分组维度数据
        if (resultDto.getGroupResults() != null && resultDto.getGroupResults().size() > 0) {
            writer.println();
            writer.println("=== 分组维度数据 ===");
            StringBuffer groupHeader = new StringBuffer("分组值");
            for (String stepName : resultDto.getStepNames()) {
                groupHeader.append(",").append(escapeCsvField(stepName));
            }
            groupHeader.append(",转化率");
            writer.println(groupHeader);
            
            for (FunnelGroupResultDto groupResult : resultDto.getGroupResults()) {
                if (groupResult.getGroupValues() != null && groupResult.getStepValues() != null) {
                    StringBuffer line = new StringBuffer();
                    String groupValueStr = String.join("|", groupResult.getGroupValues());
                    line.append(escapeCsvField(groupValueStr)).append(",");
                    
                    for (Long stepValue : groupResult.getStepValues()) {
                        line.append(stepValue != null ? stepValue : 0).append(",");
                    }
                    
                    if (groupResult.getConversionRates() != null && groupResult.getConversionRates().size() > 0) {
                        Double firstRate = groupResult.getConversionRates().get(0);
                        line.append(firstRate != null ? String.format("%.2f%%", firstRate * 100) : "0.00%");
                    }
                    
                    writer.println(line);
                }
            }
        }
    }

    /**
     * 转义CSV字段
     */
    private String escapeCsvField(String field) {
        if (field == null) return "";
        if (field.contains(",") || field.contains("\"") || field.contains("\n") || field.contains("\r")) {
            String escapedField = field.replace("\"", "\"\"");
            return "\"" + escapedField + "\"";
        }
        return field;
    }

    /**
     * 获取分组属性列表 - 复用 AnalysisUtil 的逻辑
     */
    public List<PropertyDto> groupByPropertyList(String events) {
        return metadataUtil.groupByPropertyList(events);
    }

    /**
     * 根据前端参数生成漏斗分析SQL示例 - 用于验证和调试
     * 接收前端回传的漏斗分析参数，生成对应的SQL语句
     * 
     * @param funnelAnalysisDto 前端回传的漏斗分析参数
     * @return 生成的漏斗分析SQL语句
     */
    public String generateFunnelSqlExample(FunnelAnalysisDto funnelAnalysisDto) {
        if (funnelAnalysisDto == null) {
            log.warn("漏斗分析参数为空，无法生成SQL");
            return "-- 漏斗分析参数为空";
        }

        try {
            // 验证必要参数
            if (CollectionUtils.isEmpty(funnelAnalysisDto.getFunnelSteps())) {
                log.warn("漏斗步骤为空，无法生成SQL");
                return "-- 漏斗步骤为空，请添加至少一个步骤";
            }

            if (StringUtils.isEmpty(funnelAnalysisDto.getTimeValues())) {
                log.warn("时间范围为空，无法生成SQL");
                return "-- 时间范围为空，请设置查询时间范围";
            }

            // 记录输入参数
            log.info("开始生成漏斗分析SQL，参数：{}", JSONObject.toJSONString(funnelAnalysisDto));
            
            // 调用现有的SQL生成方法
            String sql = generateFunnelAnalysisSql(funnelAnalysisDto);
            
            // 记录生成的SQL
            log.info("生成的漏斗分析SQL：\n{}", sql);
            
            return sql;
            
        } catch (Exception e) {
            log.error("生成漏斗分析SQL失败", e);
            return "-- 生成SQL失败：" + e.getMessage();
        }
    }

    /**
     * 生成简化的漏斗分析SQL - 用于快速验证
     * 根据基本的漏斗参数生成简化的SQL，便于调试和验证
     * 
     * @param steps 漏斗步骤列表
     * @param timeRange 时间范围，格式："2024-01-01,2024-01-31"
     * @param groupBy 分组字段列表（可选）
     * @param windowPeriod 时间窗口（天，可选）
     * @return 生成的简化SQL
     */
    public String generateSimpleFunnelSql(List<String> steps, String timeRange, List<String> groupBy, Integer windowPeriod) {
        if (CollectionUtils.isEmpty(steps)) {
            return "-- 漏斗步骤不能为空";
        }

        if (StringUtils.isEmpty(timeRange)) {
            return "-- 时间范围不能为空";
        }

        try {
            // 构建基础漏斗分析DTO
            FunnelAnalysisDto dto = new FunnelAnalysisDto();
            dto.setTimeValues(timeRange);
            dto.setTimeBucket(0); // 默认按天
            dto.setGroupBy(groupBy);
            dto.setWindowPeriod(windowPeriod);

            // 构建漏斗步骤
            List<FunnelStepDto> funnelSteps = new ArrayList<>();
            for (int i = 0; i < steps.size(); i++) {
                FunnelStepDto step = new FunnelStepDto();
                step.setEventName(steps.get(i));
                step.setEventAlias("步骤" + (i + 1));
                funnelSteps.add(step);
            }
            dto.setFunnelSteps(funnelSteps);

            // 生成SQL
            return generateFunnelAnalysisSql(dto);

        } catch (Exception e) {
            log.error("生成简化漏斗分析SQL失败", e);
            return "-- 生成SQL失败：" + e.getMessage();
        }
    }

    /**
     * 验证漏斗分析参数并生成SQL
     * 对前端传入的参数进行验证，并生成对应的SQL语句
     * 
     * @param requestJson 前端传入的JSON字符串
     * @return 验证结果和生成的SQL
     */
    public Map<String, Object> validateAndGenerateSql(String requestJson) {
        Map<String, Object> result = new HashMap<>();
        
        try {
            // 解析JSON参数
            FunnelAnalysisDto funnelAnalysisDto = JSONObject.parseObject(requestJson, FunnelAnalysisDto.class);
            
            if (funnelAnalysisDto == null) {
                result.put("success", false);
                result.put("message", "参数解析失败");
                result.put("sql", "-- 参数解析失败");
                return result;
            }

            // 参数验证
            List<String> errors = new ArrayList<>();
            
            if (CollectionUtils.isEmpty(funnelAnalysisDto.getFunnelSteps())) {
                errors.add("漏斗步骤不能为空");
            }
            
            if (StringUtils.isEmpty(funnelAnalysisDto.getTimeValues())) {
                errors.add("时间范围不能为空");
            }
            
            if (funnelAnalysisDto.getTimeValues() != null && !funnelAnalysisDto.getTimeValues().contains(",")) {
                errors.add("时间范围格式错误，应为：开始日期,结束日期");
            }

            if (!errors.isEmpty()) {
                result.put("success", false);
                result.put("message", String.join("; ", errors));
                result.put("sql", "-- " + String.join("; ", errors));
                return result;
            }

            // 生成SQL
            String sql = generateFunnelAnalysisSql(funnelAnalysisDto);
            
            result.put("success", true);
            result.put("message", "SQL生成成功");
            result.put("sql", sql);
            result.put("parameters", funnelAnalysisDto);
            
            return result;
            
        } catch (Exception e) {
            log.error("验证参数并生成SQL失败", e);
            result.put("success", false);
            result.put("message", "处理失败：" + e.getMessage());
            result.put("sql", "-- 处理失败：" + e.getMessage());
            return result;
        }
    }

    /**
     * 将漏斗步骤转换为事件详情对象，以便复用 AnalysisUtil 的逻辑
     */
    private EventDetailDto convertStepToEventDetail(FunnelStepDto step, FunnelAnalysisDto funnelAnalysisDto) {
        EventDetailDto eventDetail = new EventDetailDto();
        eventDetail.setTimeValues(funnelAnalysisDto.getTimeValues());
        eventDetail.setTimeBucket(funnelAnalysisDto.getTimeBucket());
        eventDetail.setGroupBy(funnelAnalysisDto.getGroupBy());
        eventDetail.setGlobalFilter(funnelAnalysisDto.getGlobalFilter());
        
        // 创建事件规则
        EventRuleDto eventRule = new EventRuleDto();
        eventRule.setEventName(step.getEventName());
        eventRule.setFilter(step.getFilter());
        eventRule.setViewBy("count(distinct uid)"); // 漏斗分析默认按用户数统计
        
        eventDetail.setEventRules(Collections.singletonList(eventRule));
        
        return eventDetail;
    }

    /**
     * 将事件分析SQL转换为漏斗步骤SQL
     */
    private String convertAnalysisSqlToStepSql(String analysisSql, int stepNumber) {
        // 从事件分析SQL中提取核心查询部分，添加步骤标识
        StringBuilder stepSql = new StringBuilder();
        stepSql.append("SELECT DISTINCT uid, starttime, ")
               .append(stepNumber).append(" as step_number, '")
               .append(stepNumber).append("' as step_name ");
        
        // 从原始SQL中提取FROM和WHERE部分
        String fromWherePart = extractFromWherePart(analysisSql);
        stepSql.append(fromWherePart);
        
        return stepSql.toString();
    }
    
    /**
     * 从事件分析SQL中提取FROM和WHERE部分
     */
    private String extractFromWherePart(String analysisSql) {
        // 简化处理：从原始SQL中提取FROM子句和WHERE条件
        int fromIndex = analysisSql.toUpperCase().indexOf("FROM");
        if (fromIndex == -1) {
            return " FROM " + analysisConfig.getEventsTable() + " WHERE 1=1";
        }
        
        String fromWherePart = analysisSql.substring(fromIndex);
        
        // 移除GROUP BY和ORDER BY部分，只保留FROM和WHERE
        int groupByIndex = fromWherePart.toUpperCase().indexOf("GROUP BY");
        if (groupByIndex != -1) {
            fromWherePart = fromWherePart.substring(0, groupByIndex);
        }
        
        return fromWherePart;
    }

    /**
     * 获取列名 - 处理不同类型的属性前缀
     */
    private String getColumnName(String propertyName) {
        if (propertyName.startsWith("C|")) {
            String commonColumn = propertyName.substring(2);
            
            // 特殊处理新用户判断
            if ("d_newflag".equals(commonColumn)) {
                return "ifly_map_get(tags,'" + commonColumn + "')";
            }
            
            if (commonPros().contains(commonColumn)) {
                return commonColumn;
            } else {
                return "ifly_map_get(tags,'" + commonColumn + "')";
            }
        } else if (propertyName.startsWith("U|")) {
            // 用户属性 - 在JOIN的情况下直接使用列名
            String profileColumn = propertyName.substring(2);
            
            // 特殊处理AB实验
            if ("expinfo".equals(profileColumn)) {
                return "expinfo"; // 在JOIN时会映射为 groupid as expinfo
            }
            
            // 处理临时标签
            if (profileColumn.startsWith("temp_tags")) {
                return "temp_tags";
            }
            
            return profileColumn;
        } else if (propertyName.startsWith("D|")) {
            return "dim_column";
        } else {
            return "ifly_map_get(tags,'" + propertyName + "')";
        }
    }
}
