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
 * 漏斗分析工具类
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
     * 生成漏斗分析SQL
     */
    public String generateFunnelAnalysisSql(FunnelAnalysisDto funnelAnalysisDto) {
        try {
            // 参数验证
            validateFunnelAnalysisDto(funnelAnalysisDto);
            
            List<FunnelStepDto> steps = funnelAnalysisDto.getFunnelSteps();

            String times = funnelAnalysisDto.getTimeValues();
            String[] timeArr = times.split(",");
            
            if (timeArr.length != 2) {
                throw new IllegalArgumentException("时间范围格式错误，应为：开始日期,结束日期");
            }
            
            String startDate = DateUtil.StringToString(timeArr[0].trim(), DateStyle.YYYY_MM_DD, DateStyle.YYYYMMDD);
            String endDate = DateUtil.StringToString(timeArr[1].trim(), DateStyle.YYYY_MM_DD, DateStyle.YYYYMMDD);
            
            // 验证日期格式
            if (StringUtils.isEmpty(startDate) || StringUtils.isEmpty(endDate)) {
                throw new IllegalArgumentException("日期格式错误，请使用YYYY-MM-DD格式");
            }

            // 构建每个步骤的子查询
            List<String> stepQueries = new ArrayList<>();
            for (int i = 0; i < steps.size(); i++) {
                FunnelStepDto step = steps.get(i);
                try {
                    // 为每个步骤计算合适的日期范围，考虑时间窗口
                    String stepDateCondition = buildStepDateCondition(startDate, endDate, i, funnelAnalysisDto);
                    String stepQuery = buildStepQueryUsingAnalysisUtil(step, i + 1, stepDateCondition, funnelAnalysisDto);
                    stepQueries.add(stepQuery);
                    log.debug("步骤{} SQL生成成功: {}", i + 1, stepQuery);
                } catch (Exception e) {
                    log.error("步骤{} SQL生成失败: {}", i + 1, e.getMessage(), e);
                    throw new RuntimeException("步骤" + (i + 1) + " SQL生成失败: " + e.getMessage(), e);
                }
            }

            // 构建最终的漏斗分析SQL
            String finalSql = buildFunnelSql(stepQueries, funnelAnalysisDto);
            log.info("漏斗分析SQL生成成功，共{}个步骤", steps.size());
            return finalSql;
            
        } catch (Exception e) {
            log.error("生成漏斗分析SQL失败", e);
            throw new RuntimeException("生成漏斗分析SQL失败: " + e.getMessage(), e);
        }
    }
    
    /**
     * 为每个步骤构建合适的日期范围条件，考虑时间窗口
     * 第一步不加时间窗，从第二步开始加时间窗
     */
    private String buildStepDateCondition(String startDate, String endDate, int stepIndex, FunnelAnalysisDto funnelAnalysisDto) {
        // 第一步使用原始时间范围，不加时间窗
        if (stepIndex == 0) {
            return String.format(" proc_date >= '%s' AND proc_date <= '%s' ", startDate, endDate);
        }
        
        // 获取时间窗口类型和窗口期
        Integer windowType = funnelAnalysisDto.getWindowType();
        if (windowType == null) windowType = 0; // 默认为自定义天数
        
        if (windowType == 1) {
            // 首日：所有步骤都使用相同的日期范围
            return String.format(" proc_date >= '%s' AND proc_date <= '%s' ", startDate, endDate);
        } else if (windowType == 2) {
            // 次日：所有步骤都使用相同的日期范围
            return String.format(" proc_date >= '%s' AND proc_date <= '%s' ", startDate, endDate);
        } else {
            // 自定义天数：从第二步开始考虑时间窗口扩展
            Integer windowPeriod = funnelAnalysisDto.getWindowPeriod();
            if (windowPeriod == null || windowPeriod <= 0) {
                // 如果没有设置窗口期，使用原始时间范围
                return String.format(" proc_date >= '%s' AND proc_date <= '%s' ", startDate, endDate);
            }
            
            // 计算该步骤的最大时间窗口
            // 第n步的最大时间窗口 = 原始时间范围 + (n-1) * 窗口期
            int maxWindowDays = windowPeriod * stepIndex;
            
            // 扩展结束日期
            String extendedEndDate = DateUtil.addDay(endDate, maxWindowDays);
            
            log.info("步骤{}日期范围计算: 原始范围={}~{}, 窗口期={}, 扩展天数={}, 最终范围={}~{}", 
                    stepIndex + 1, startDate, endDate, windowPeriod, maxWindowDays, startDate, extendedEndDate);
            
            return String.format(" proc_date >= '%s' AND proc_date <= '%s' ", startDate, extendedEndDate);
        }
    }
    
    /**
     * 验证漏斗分析DTO参数
     */
    private void validateFunnelAnalysisDto(FunnelAnalysisDto funnelAnalysisDto) {
        if (funnelAnalysisDto == null) {
            throw new IllegalArgumentException("漏斗分析参数不能为空");
        }
        
        List<FunnelStepDto> steps = funnelAnalysisDto.getFunnelSteps();
        if (CollectionUtils.isEmpty(steps)) {
            throw new IllegalArgumentException("漏斗步骤不能为空");
        }
        
        if (StringUtils.isEmpty(funnelAnalysisDto.getTimeValues())) {
            throw new IllegalArgumentException("时间范围不能为空");
        }
        
        // 验证每个步骤
        for (int i = 0; i < steps.size(); i++) {
            FunnelStepDto step = steps.get(i);
            if (step == null) {
                throw new IllegalArgumentException("第" + (i + 1) + "步不能为空");
            }
            
            if (StringUtils.isEmpty(step.getEventName())) {
                throw new IllegalArgumentException("第" + (i + 1) + "步事件名称不能为空");
            }
        }
        
        // 验证窗口期和时间窗口类型
        Integer windowType = funnelAnalysisDto.getWindowType();
        if (windowType == null) windowType = 0; // 默认为自定义天数
        
        if (windowType == 0) {
            if (funnelAnalysisDto.getWindowPeriod() != null && funnelAnalysisDto.getWindowPeriod() <= 0) {
                throw new IllegalArgumentException("窗口期必须大于0");
            }
        } else if (windowType == 1 || windowType == 2) {
            // 首日或次日：不需要验证窗口期
            log.info("使用特殊时间窗口类型: {}", windowType == 1 ? "首日" : "次日");
        } else {
            throw new IllegalArgumentException("时间窗口类型无效，应为0（自定义天数）、1（首日）或2（次日）");
        }
        
        // 验证时间粒度
        if (funnelAnalysisDto.getTimeBucket() != null && 
            (funnelAnalysisDto.getTimeBucket() < 0 || funnelAnalysisDto.getTimeBucket() > 5)) {
            throw new IllegalArgumentException("时间粒度参数无效，应为0-5之间的整数");
        }
    }

    /**
     * 使用 AnalysisUtil 构建单个步骤的查询SQL
     */
    private String buildStepQueryUsingAnalysisUtil(FunnelStepDto step, int stepNumber, String dateCondition, FunnelAnalysisDto funnelAnalysisDto) {
        // 将漏斗步骤转换为事件分析参数
        EventDetailDto eventDetail = convertStepToEventDetail(step, funnelAnalysisDto);

        return buildStepQueryDirectly(step, stepNumber, dateCondition, funnelAnalysisDto);
    }

    /**
     * 直接构建步骤查询SQL
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
        if (needJoinUser) {
            // 需要JOIN用户表的情况
            // 根据漏斗类型决定是否使用DISTINCT
            if (funnelAnalysisDto.getFunnelType() != null && funnelAnalysisDto.getFunnelType() == 1) {
                // 按次数分析：不使用DISTINCT，保留所有记录
                sql.append("SELECT events.uid, events.starttime, events.proc_date, ")
                   .append(stepNumber).append(" as step_number, '")
                   .append(stepNumber).append("' as step_name");
            } else {
                // 按人数分析：使用DISTINCT，去重用户
                sql.append("SELECT DISTINCT events.uid, events.starttime, events.proc_date, ")
                   .append(stepNumber).append(" as step_number, '")
                   .append(stepNumber).append("' as step_name");
            }
            
            // 添加用户属性列
            if (CollectionUtils.isNotEmpty(userColumns)) {
                for (String userColumn : userColumns) {
                    sql.append(", u.").append(userColumn);
                }
            }
            
            // 添加分组字段
            if (CollectionUtils.isNotEmpty(funnelAnalysisDto.getGroupBy())) {
                for (String groupField : funnelAnalysisDto.getGroupBy()) {
                    if (groupField.startsWith("C|")) {
                        String commonColumn = groupField.substring(2);
                        if ("d_newflag".equals(commonColumn)) {
                            sql.append(", ifly_map_get(events.tags,'").append(commonColumn).append("') as `").append(groupField).append("`");
                        } else if (commonPros().contains(commonColumn)) {
                            sql.append(", events.").append(commonColumn).append(" as `").append(groupField).append("`");
                        } else {
                            sql.append(", ifly_map_get(events.tags,'").append(commonColumn).append("') as `").append(groupField).append("`");
                        }
                    } else if (!groupField.startsWith("U|") && !groupField.startsWith("D|")) {
                        sql.append(", ifly_map_get(events.tags,'").append(groupField).append("') as `").append(groupField).append("`");
                    }
                }
            }
            
            sql.append(" FROM (");
            
            // 构建事件表子查询
            sql.append("SELECT ").append(buildEventSelectColumns(userColumns))
               .append(" FROM ").append(analysisConfig.getEventsTable())
               .append(" WHERE 1=1 AND ").append(dateCondition);
            
            // 添加事件名称条件
            addEventNameCondition(sql, step);
            
            // 添加事件属性过滤
            addEventFilterConditions(sql, step, new ArrayList<>());
            
            // 添加全局过滤条件（只包含事件表字段的条件）
            addEventTableGlobalFilterConditions(sql, funnelAnalysisDto);
            
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
            
            // 在JOIN后添加用户属性相关的过滤条件
            addUserPropertyFilterConditions(sql, step, funnelAnalysisDto);
            
        } else {
            // 不需要JOIN用户表的情况
            // 根据漏斗类型决定是否使用DISTINCT
            if (funnelAnalysisDto.getFunnelType() != null && funnelAnalysisDto.getFunnelType() == 1) {
                // 按次数分析：不使用DISTINCT，保留所有记录
                sql.append("SELECT uid, starttime, proc_date, ")
                   .append(stepNumber).append(" as step_number, '")
                   .append(stepNumber).append("' as step_name");
            } else {
                // 按人数分析：使用DISTINCT，去重用户
                sql.append("SELECT DISTINCT uid, starttime, proc_date, ")
                   .append(stepNumber).append(" as step_number, '")
                   .append(stepNumber).append("' as step_name");
            }
            
            // 添加分组字段（如果有的话）
            if (CollectionUtils.isNotEmpty(funnelAnalysisDto.getGroupBy())) {
                for (String groupField : funnelAnalysisDto.getGroupBy()) {
                    if (groupField.startsWith("C|")) {
                        String commonColumn = groupField.substring(2);
                        if ("d_newflag".equals(commonColumn)) {
                            sql.append(", ifly_map_get(tags,'").append(commonColumn).append("') as `").append(groupField).append("`");
                        } else if (commonPros().contains(commonColumn)) {
                            sql.append(", ").append(commonColumn).append(" as `").append(groupField).append("`");
                        } else {
                            sql.append(", ifly_map_get(tags,'").append(commonColumn).append("') as `").append(groupField).append("`");
                        }
                    } else if (!groupField.startsWith("U|") && !groupField.startsWith("D|")) {
                        sql.append(", ifly_map_get(tags,'").append(groupField).append("') as `").append(groupField).append("`");
                    }
                }
            }
            
            sql.append(" FROM ").append(analysisConfig.getEventsTable())
               .append(" WHERE 1=1 AND ").append(dateCondition);
            
            // 添加事件名称条件
            addEventNameCondition(sql, step);
            
            // 添加事件属性过滤
            addEventFilterConditions(sql, step, new ArrayList<>());
            
            // 添加全局过滤条件
            addEventTableGlobalFilterConditions(sql, funnelAnalysisDto);
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
     * 添加事件过滤条件（只包含事件表字段的条件）
     */
    private void addEventFilterConditions(StringBuilder sql, FunnelStepDto step, List<String> userColumns) {
        if (step.getFilter() != null && CollectionUtils.isNotEmpty(step.getFilter().getSubFilters())) {
            String filterSql = buildEventTableFilterSql(step.getFilter());
            if (StringUtils.isNotEmpty(filterSql)) {
                sql.append(" AND (").append(filterSql).append(")");
            }
        }
    }
    
    /**
     * 添加全局过滤条件（只包含事件表字段的条件）
     */
    private void addGlobalFilterConditions(StringBuilder sql, FunnelAnalysisDto funnelAnalysisDto, List<String> userColumns) {
        if (funnelAnalysisDto.getGlobalFilter() != null) {
            String globalFilterSql = buildEventTableGlobalFilterSql(funnelAnalysisDto.getGlobalFilter());
            if (StringUtils.isNotEmpty(globalFilterSql)) {
                sql.append(" AND (").append(globalFilterSql).append(")");
            }
        }
    }

    /**
     * 添加事件表全局过滤条件（只包含事件表字段的条件）
     */
    private void addEventTableGlobalFilterConditions(StringBuilder sql, FunnelAnalysisDto funnelAnalysisDto) {
        if (funnelAnalysisDto.getGlobalFilter() != null) {
            String globalFilterSql = buildEventTableGlobalFilterSql(funnelAnalysisDto.getGlobalFilter());
            if (StringUtils.isNotEmpty(globalFilterSql)) {
                sql.append(" AND (").append(globalFilterSql).append(")");
            }
        }
    }

    /**
     * 获取虚拟事件SQL
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
     * 构建事件过滤条件SQL
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
     * 构建属性条件
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
                
                // 构建 ConditionDto 对象
                ConditionDto conditionDto = new ConditionDto();
                conditionDto.setColumnName(column);
                conditionDto.setOperationName(operation.getName());
                conditionDto.setOperationValue(operationValue);
                
                // 对于公共属性，使用实际字段类型而不是操作类型
                Integer actualColumnType = getActualColumnType(propertyName);
                conditionDto.setColumnType(actualColumnType != null ? actualColumnType : operation.getColumnType());
                
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

        // 时间维度处理 - 只要不是累计模式就添加时间维度
        boolean hasTimeBucket = funnelAnalysisDto.getTimeBucket() != null && funnelAnalysisDto.getTimeBucket() != 5;
        if (hasTimeBucket) {
            String timeFormat = getTimeFormat(funnelAnalysisDto.getTimeBucket());
            sql.append(timeFormat).append(" as time_bucket, ");
        }

        // 各步骤的统计 - 根据漏斗类型决定统计方式
        for (int i = 1; i <= stepQueries.size(); i++) {
            if (funnelAnalysisDto.getFunnelType() != null && funnelAnalysisDto.getFunnelType() == 1) {
                // 按次数分析：统计事件次数
                sql.append("COUNT(CASE WHEN step_").append(i).append(".uid IS NOT NULL THEN 1 END) as step_").append(i).append("_count");
            } else {
                // 按人数分析：统计去重用户数
                sql.append("COUNT(DISTINCT CASE WHEN step_").append(i).append(".uid IS NOT NULL THEN step_").append(i).append(".uid END) as step_").append(i).append("_count");
            }
            if (i < stepQueries.size()) sql.append(", ");
        }

        // FROM子句 - 根据时间窗口类型决定JOIN逻辑
        sql.append(" FROM step_1");
        for (int i = 2; i <= stepQueries.size(); i++) {
            sql.append(" LEFT JOIN step_").append(i)
               .append(" ON step_1.uid = step_").append(i).append(".uid");
            
            // 根据时间窗口类型添加不同的时间限制
            Integer windowType = funnelAnalysisDto.getWindowType();
            if (windowType == null) windowType = 0; // 默认为自定义天数
            
            if (windowType == 1) {
                // 首日：只计算当日内的漏斗，不考虑事件先后顺序
                sql.append(" AND DATE(step_1.starttime) = DATE(step_").append(i).append(".starttime)");
            } else if (windowType == 2) {
                // 次日：计算两日内的漏斗，不考虑事件先后顺序
                sql.append(" AND DATE(step_").append(i).append(".starttime) BETWEEN DATE(step_1.starttime) AND DATE(step_1.starttime) + INTERVAL 1 DAY");
            } else {
                // 自定义天数：保持一天、七天等时间窗口的原有逻辑，考虑事件先后顺序和时间窗口
                sql.append(" AND step_1.starttime <= step_").append(i).append(".starttime");
                if (funnelAnalysisDto.getWindowPeriod() != null && funnelAnalysisDto.getWindowPeriod() > 0) {
                    // 使用当前窗口期，而不是累积计算
                    int windowPeriod = funnelAnalysisDto.getWindowPeriod();
                    
                    log.info("步骤{}时间限制计算: 窗口期={}", i, windowPeriod);
                    
                    sql.append(" AND step_").append(i).append(".starttime <= step_1.starttime + INTERVAL ")
                       .append(windowPeriod).append(" DAY");
                }
            }
        }

        // GROUP BY子句 - 只要有分组字段或时间维度就添加GROUP BY
        boolean hasGroupBy = CollectionUtils.isNotEmpty(groupByFields) && !groupByFields.contains(ALL);
        
        if (hasGroupBy || hasTimeBucket) {
            sql.append(" GROUP BY ");
            if (hasGroupBy) {
                String groupByClause = buildGroupByClause(groupByFields);
                if (StringUtils.isNotEmpty(groupByClause)) {
                    sql.append(groupByClause).append(", ");
                }
            }
            if (hasTimeBucket) {
                String timeFormat = getTimeFormat(funnelAnalysisDto.getTimeBucket());
                sql.append(timeFormat);
            }
        }

        // ORDER BY子句 - 只有在有GROUP BY时才添加ORDER BY
        if (hasGroupBy || hasTimeBucket) {
            sql.append(" ORDER BY time_bucket");
            if (hasGroupBy) {
                // 使用SELECT子句中的别名，而不是表字段引用
                for (String field : groupByFields) {
                    sql.append(", `").append(field).append("`");
                }
            }
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
     * 构建单个分组字段的SELECT部分
     */
    private String buildGroupBySelectField(String field) {
        if (field.startsWith("C|")) {
            String commonColumn = field.substring(2);
            
            // 特殊处理新用户判断
            if ("d_newflag".equals(commonColumn)) {
                return "ifly_map_get(step_1.tags,'" + commonColumn + "') as `" + field + "`";
            }
            
            if (commonPros().contains(commonColumn)) {
                return "step_1." + commonColumn + " as `" + field + "`";
            } else {
                return "ifly_map_get(step_1.tags,'" + commonColumn + "') as `" + field + "`";
            }
        } else if (field.startsWith("U|")) {
            String profileColumn = field.substring(2);
            return "step_1." + profileColumn + " as `" + field + "`";
        } else if (field.startsWith("D|")) {
            return "step_1.dim_column as `" + field + "`";
        } else {
            return "ifly_map_get(step_1.tags,'" + field + "') as `" + field + "`";
        }
    }

    /**
     * 构建分组查询的GROUP BY部分
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
     * 构建单个分组字段的GROUP BY列
     */
    private String buildGroupByColumn(String field) {
        if (field.startsWith("C|")) {
            String commonColumn = field.substring(2);
            
            // 特殊处理新用户判断
            if ("d_newflag".equals(commonColumn)) {
                return "ifly_map_get(step_1.tags,'" + commonColumn + "')";
            }
            
            if (commonPros().contains(commonColumn)) {
                return "step_1." + commonColumn;
            } else {
                return "ifly_map_get(step_1.tags,'" + commonColumn + "')";
            }
        } else if (field.startsWith("U|")) {
            String profileColumn = field.substring(2);
            return "step_1." + profileColumn;
        } else if (field.startsWith("D|")) {
            return "step_1.dim_column";
        } else {
            return "ifly_map_get(step_1.tags,'" + field + "')";
        }
    }

    /**
     * 获取时间格式
     */
    private String getTimeFormat(Integer timeBucket) {
        if (timeBucket == null) return "step_1.proc_date";
        
        switch (timeBucket) {
            case 0: return "step_1.proc_date"; // 按天
            case 1: return "from_timestamp(step_1.starttime,'yyyy-MM-dd HH')"; // 按小时
            case 2: return "from_timestamp(step_1.starttime,'yyyy-MM-dd HH:mm')"; // 按分钟
            case 3: return "date_trunc('week', step_1.starttime)"; // 按周
            case 4: return "substr(step_1.proc_date,1,6)"; // 按月
            case 5: return "'累计'"; // 累计
            default: return "step_1.proc_date";
        }
    }

    /**
     * 获取公共属性列表
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

        // 缓存处理逻辑
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
            
            // 提取步骤名称 - 优先使用eventAlias，否则使用eventName
            List<String> stepNames = originalRequest.getFunnelSteps().stream()
                    .map(step -> StringUtils.isNotEmpty(step.getEventAlias()) ? step.getEventAlias() : step.getEventName())
                    .collect(Collectors.toList());
            result.setStepNames(stepNames);

            // 处理总体数据 - 聚合所有行的数据
            if (CollectionUtils.isNotEmpty(rawData)) {
                List<Long> stepValues = new ArrayList<>();
                List<Double> conversionRates = new ArrayList<>();
                
                // 聚合所有时间点的数据
                for (int i = 0; i < stepNames.size(); i++) {
                    String stepKey = "step_" + (i + 1) + "_count";
                    Long totalStepValue = 0L;
                    
                    // 遍历所有行，累加每个步骤的计数
                    for (Map<String, Object> rowData : rawData) {
                        Long stepValue = getLongValue(rowData.get(stepKey));
                        totalStepValue += stepValue;
                    }
                    
                    stepValues.add(totalStepValue);
                }
                
                // 计算转化率
                Long firstStepValue = stepValues.get(0);
                for (int i = 0; i < stepValues.size(); i++) {
                    if (i == 0) {
                        conversionRates.add(1.0); // 第一步转化率为100%
                    } else {
                        double rate = firstStepValue != null && firstStepValue > 0 ? 
                                (double) stepValues.get(i) / firstStepValue : 0.0;
                        conversionRates.add(rate);
                    }
                }
                
                result.setStepValues(stepValues);
                result.setConversionRates(conversionRates);
                
                log.info("漏斗分析结果解析完成 - 步骤名称: {}, 步骤值: {}, 转化率: {}", stepNames, stepValues, conversionRates);
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
            // 1. 收集时间点列表
            Set<String> timeSet = rawData.stream()
                    .map(data -> String.valueOf(data.get("time_bucket")))
                    .collect(Collectors.toSet());
            result.setTimeSeries(new ArrayList<>(timeSet));
            
            // 2. 构建时间序列详细数据
            List<FunnelTimeSeriesDto> timeSeriesDataList = buildTimeSeriesData(rawData, result.getStepNames().size());
            result.setTimeSeriesData(timeSeriesDataList);
            
            log.info("时间序列数据构建完成，时间点数量: {}", timeSeriesDataList.size());
        }
    }

    /**
     * 构建时间序列数据
     */
    private List<FunnelTimeSeriesDto> buildTimeSeriesData(List<Map<String, Object>> rawData, int stepCount) {
        List<FunnelTimeSeriesDto> timeSeriesDataList = new ArrayList<>();
        
        // 按时间点分组
        Map<String, List<Map<String, Object>>> groupedByTime = rawData.stream()
                .collect(Collectors.groupingBy(data -> String.valueOf(data.get("time_bucket"))));
        
        // 对每个时间点构建数据
        for (Map.Entry<String, List<Map<String, Object>>> entry : groupedByTime.entrySet()) {
            String timePoint = entry.getKey();
            List<Map<String, Object>> timePointData = entry.getValue();
            
            FunnelTimeSeriesDto timeSeriesDto = new FunnelTimeSeriesDto();
            timeSeriesDto.setTimePoint(timePoint);
            
            // 聚合该时间点的各步骤数据
            List<Long> stepValues = new ArrayList<>();
            for (int i = 0; i < stepCount; i++) {
                String stepKey = "step_" + (i + 1) + "_count";
                Long totalStepValue = 0L;
                
                // 累加该时间点的数据
                for (Map<String, Object> rowData : timePointData) {
                    Long stepValue = getLongValue(rowData.get(stepKey));
                    totalStepValue += stepValue;
                }
                
                stepValues.add(totalStepValue);
            }
            
            // 计算该时间点的转化率
            List<Double> conversionRates = calculateConversionRates(stepValues);
            
            timeSeriesDto.setStepValues(stepValues);
            timeSeriesDto.setConversionRates(conversionRates);
            
            timeSeriesDataList.add(timeSeriesDto);
        }
        
        // 按时间点排序
        timeSeriesDataList.sort(Comparator.comparing(FunnelTimeSeriesDto::getTimePoint));
        
        return timeSeriesDataList;
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
     * 获取分组属性列表
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
     * 将漏斗步骤转换为事件详情对象
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
        
        // 根据漏斗类型设置统计方式
        if (funnelAnalysisDto.getFunnelType() != null && funnelAnalysisDto.getFunnelType() == 1) {
            eventRule.setViewBy("count(1)"); // 按次数分析
        } else {
            eventRule.setViewBy("count(distinct uid)"); // 按人数分析
        }
        
        eventDetail.setEventRules(Collections.singletonList(eventRule));
        
        return eventDetail;
    }

    /**
     * 将事件分析SQL转换为漏斗步骤SQL
     */
    private String convertAnalysisSqlToStepSql(String analysisSql, int stepNumber, FunnelAnalysisDto funnelAnalysisDto) {
        // 从事件分析SQL中提取核心查询部分，添加步骤标识
        StringBuilder stepSql = new StringBuilder();
        
        // 根据漏斗类型决定是否使用DISTINCT
        if (funnelAnalysisDto.getFunnelType() != null && funnelAnalysisDto.getFunnelType() == 1) {
            // 按次数分析：不使用DISTINCT，保留所有记录
            stepSql.append("SELECT uid, starttime, proc_date, ")
                   .append(stepNumber).append(" as step_number, '")
                   .append(stepNumber).append("' as step_name ");
        } else {
            // 按人数分析：使用DISTINCT，去重用户
            stepSql.append("SELECT DISTINCT uid, starttime, proc_date, ")
                   .append(stepNumber).append(" as step_number, '")
                   .append(stepNumber).append("' as step_name ");
        }
        
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
    
    /**
     * 在JOIN后添加用户属性相关的过滤条件
     */
    private void addUserPropertyFilterConditions(StringBuilder sql, FunnelStepDto step, FunnelAnalysisDto funnelAnalysisDto) {
        List<String> userConditions = new ArrayList<>();
        
        // 收集步骤筛选条件中的用户属性条件
        if (step.getFilter() != null && CollectionUtils.isNotEmpty(step.getFilter().getSubFilters())) {
            for (EventPropertyDto property : step.getFilter().getSubFilters()) {
                if (property.getPropertyName().startsWith("U|")) {
                    String condition = buildUserPropertyCondition(property);
                    if (StringUtils.isNotEmpty(condition)) {
                        userConditions.add(condition);
                    }
                }
            }
        }
        
        // 收集全局筛选条件中的用户属性条件
        if (funnelAnalysisDto.getGlobalFilter() != null && CollectionUtils.isNotEmpty(funnelAnalysisDto.getGlobalFilter().getSubFilters())) {
            for (EventPropertyDto property : funnelAnalysisDto.getGlobalFilter().getSubFilters()) {
                if (property.getPropertyName().startsWith("U|")) {
                    String condition = buildUserPropertyCondition(property);
                    if (StringUtils.isNotEmpty(condition)) {
                        userConditions.add(condition);
                    }
                }
            }
        }
        
        // 如果有用户属性条件，添加到WHERE子句中
        if (CollectionUtils.isNotEmpty(userConditions)) {
            sql.append(" WHERE ");
            
            // 分别处理步骤筛选条件和全局筛选条件的用户属性
            List<String> stepUserConditions = new ArrayList<>();
            List<String> globalUserConditions = new ArrayList<>();
            
            // 分离步骤筛选条件中的用户属性
            if (step.getFilter() != null && CollectionUtils.isNotEmpty(step.getFilter().getSubFilters())) {
                for (EventPropertyDto property : step.getFilter().getSubFilters()) {
                    if (property.getPropertyName().startsWith("U|")) {
                        String condition = buildUserPropertyCondition(property);
                        if (StringUtils.isNotEmpty(condition)) {
                            stepUserConditions.add(condition);
                        }
                    }
                }
            }
            
            // 分离全局筛选条件中的用户属性
            if (funnelAnalysisDto.getGlobalFilter() != null && CollectionUtils.isNotEmpty(funnelAnalysisDto.getGlobalFilter().getSubFilters())) {
                for (EventPropertyDto property : funnelAnalysisDto.getGlobalFilter().getSubFilters()) {
                    if (property.getPropertyName().startsWith("U|")) {
                        String condition = buildUserPropertyCondition(property);
                        if (StringUtils.isNotEmpty(condition)) {
                            globalUserConditions.add(condition);
                        }
                    }
                }
            }
            
            // 构建最终的WHERE条件
            List<String> finalConditions = new ArrayList<>();
            
            if (CollectionUtils.isNotEmpty(stepUserConditions)) {
                if (step.getFilter() != null) {
                    finalConditions.add("(" + Joiner.on(" " + step.getFilter().getRelation() + " ").join(stepUserConditions) + ")");
                } else {
                    finalConditions.addAll(stepUserConditions);
                }
            }
            
            if (CollectionUtils.isNotEmpty(globalUserConditions)) {
                if (funnelAnalysisDto.getGlobalFilter() != null) {
                    finalConditions.add("(" + Joiner.on(" " + funnelAnalysisDto.getGlobalFilter().getRelation() + " ").join(globalUserConditions) + ")");
                } else {
                    finalConditions.addAll(globalUserConditions);
                }
            }
            
            if (CollectionUtils.isNotEmpty(finalConditions)) {
                sql.append(Joiner.on(" AND ").join(finalConditions));
            }
        }
    }
    
    /**
     * 构建用户属性条件，使用u.前缀
     */
    private String buildUserPropertyCondition(EventPropertyDto property) {
        if (property == null) {
            return "";
        }
        
        String propertyName = property.getPropertyName();
        String operationValue = property.getPropertyOperationValue();
        Integer operationId = property.getPropertyOperationId();
        
        // 获取用户属性列名（去掉U|前缀）
        String userColumn = propertyName.substring(2);
        
        // 根据操作类型构建条件
        if (operationId != null) {
            Operation operation = iOperationService.selectById(operationId);
            if (operation != null) {
                // 构建 ConditionDto 对象
                ConditionDto conditionDto = new ConditionDto();
                conditionDto.setColumnName("u." + userColumn); // 使用u.前缀
                conditionDto.setOperationName(operation.getName());
                conditionDto.setOperationValue(operationValue);
                
                // 对于用户属性，使用实际字段类型而不是操作类型
                Integer actualColumnType = getActualUserColumnType(userColumn);
                conditionDto.setColumnType(actualColumnType != null ? actualColumnType : operation.getColumnType());

                return metadataUtil.getSql(conditionDto);
            }
        }
        
        // 默认等于条件
        return "u." + userColumn + " = '" + operationValue + "'";
    }
    
    /**
     * 获取字段的实际类型
     */
    private Integer getActualColumnType(String propertyName) {
        // 1. 处理公共属性 (C|)
        if (propertyName.startsWith("C|")) {
            String commonColumn = propertyName.substring(2);
            // 从MetadataUtil获取公共属性的实际类型
            Map<String, String> commonProsMap = metadataUtil.getCommonProsMap();
            String actualType = commonProsMap.get(commonColumn);
            if (actualType != null) {
                return convertTypeStringToInteger(actualType);
            }
        }
        
        // 2. 处理用户属性 (U|)
        if (propertyName.startsWith("U|")) {
            String profileColumn = propertyName.substring(2);
            try {
                MetadataProfileColumn metadataProfileColumn = iMetadataProfileColumnService.selectByName(profileColumn);
                if (metadataProfileColumn != null) {
                    return Integer.valueOf(metadataProfileColumn.getType());
                }
            } catch (Exception e) {
                log.warn("查询用户画像列类型失败: {}", profileColumn, e);
            }
        }
        
        // 3. 处理维度属性 (D|)
        if (propertyName.startsWith("D|")) {
            // 维度属性通常需要查询DimColumn表
            return 2; // 默认字符串类型
        }
        
        // 4. 处理私有属性
        try {
            // 尝试查询该属性的元数据信息
            MetadataEventProperty metadataEventProperty = iMetadataEventPropertyService.selectByEventAndName("all", propertyName);
            if (metadataEventProperty != null && StringUtils.isNotEmpty(metadataEventProperty.getType())) {
                return convertTypeStringToInteger(metadataEventProperty.getType());
            }
        } catch (Exception e) {
            log.debug("查询私有属性类型失败: {}, 使用默认类型", propertyName, e);
        }
        
        // 5. 默认情况：返回null，让上层使用操作类型
        return null;
    }
    
    /**
     * 将类型字符串转换为整数类型
     */
    private Integer convertTypeStringToInteger(String typeString) {
        if (StringUtils.isEmpty(typeString)) {
            return 2; // 默认为字符串类型
        }
        
        switch (typeString.toLowerCase()) {
            case "string":
                return 2;
            case "int":
            case "long":
            case "integer":
                return 0;
            case "double":
            case "number":
            case "float":
                return 1;
            case "bool":
            case "boolean":
                return 6;
            case "datetime":
            case "date":
            case "timestamp":
                return 5;
            case "list":
            case "array":
                return 3;
            case "map":
            case "object":
                return 4;
            default:
                return 2; // 默认为字符串类型
        }
    }
    
    /**
     * 构建事件表过滤条件SQL（只包含事件表字段）
     */
    private String buildEventTableFilterSql(PropertyFilterDto filter) {
        if (filter == null || CollectionUtils.isEmpty(filter.getSubFilters())) {
            return "";
        }

        List<String> conditions = new ArrayList<>();
        for (EventPropertyDto property : filter.getSubFilters()) {
            // 只处理事件表字段的条件，跳过用户属性字段
            if (!property.getPropertyName().startsWith("U|")) {
                String condition = buildPropertyCondition(property);
                if (StringUtils.isNotEmpty(condition)) {
                    conditions.add(condition);
                }
            }
        }

        if (CollectionUtils.isNotEmpty(conditions)) {
            return Joiner.on(" " + filter.getRelation() + " ").join(conditions);
        }
        return "";
    }

    /**
     * 构建事件表全局过滤条件SQL（只包含事件表字段）
     */
    private String buildEventTableGlobalFilterSql(PropertyFilterDto globalFilter) {
        if (globalFilter == null || CollectionUtils.isEmpty(globalFilter.getSubFilters())) {
            return "";
        }
        
        List<String> filterSqls = new ArrayList<>();
        for (EventPropertyDto subFilter : globalFilter.getSubFilters()) {
            // 只处理事件表字段的条件，跳过用户属性字段
            if (!subFilter.getPropertyName().startsWith("U|")) {
                String condition = buildPropertyCondition(subFilter);
                if (StringUtils.isNotEmpty(condition)) {
                    filterSqls.add(condition);
                }
            }
        }
        
        if (CollectionUtils.isNotEmpty(filterSqls)) {
            return Joiner.on(" " + globalFilter.getRelation() + " ").join(filterSqls);
        }
        return "";
    }
    
    

    /**
     * 获取用户属性的实际类型
     */
    private Integer getActualUserColumnType(String userColumn) {
        try {
            MetadataProfileColumn metadataProfileColumn = iMetadataProfileColumnService.selectByName(userColumn);
            if (metadataProfileColumn != null) {
                return Integer.valueOf(metadataProfileColumn.getType());
            }
        } catch (Exception e) {
            log.warn("查询用户画像列类型失败: {}", userColumn, e);
        }
        
        // 如果查询失败，根据列名进行推测
        if (userColumn.toLowerCase().contains("age") || 
            userColumn.toLowerCase().contains("count") || 
            userColumn.toLowerCase().contains("num")) {
            return 0; // 推测为整数类型
        }
        
        return 2; // 默认为字符串类型
    }

    /**
     * 测试时间窗口修复的方法
     * 验证第一步不加时间窗，从第二步开始加时间窗
     */
    public String testTimeWindowFix() {
        // 创建测试用的漏斗分析DTO
        FunnelAnalysisDto testDto = new FunnelAnalysisDto();
        testDto.setTimeValues("2025-10-07,2025-10-14");
        testDto.setWindowType(0); // 自定义天数
        testDto.setWindowPeriod(2); // 2天窗口期
        
        // 创建测试步骤
        List<FunnelStepDto> steps = new ArrayList<>();
        
        FunnelStepDto step1 = new FunnelStepDto();
        step1.setEventName("FT45113");
        step1.setEventAlias("步骤1");
        steps.add(step1);
        
        FunnelStepDto step2 = new FunnelStepDto();
        step2.setEventName("FT45114");
        step2.setEventAlias("步骤2");
        steps.add(step2);
        
        FunnelStepDto step3 = new FunnelStepDto();
        step3.setEventName("FT45115");
        step3.setEventAlias("步骤3");
        steps.add(step3);
        
        testDto.setFunnelSteps(steps);
        
        // 生成SQL
        String sql = generateFunnelAnalysisSql(testDto);
        
        log.info("=== 时间窗口修复测试 ===");
        log.info("测试参数: 时间范围=2025-10-07~2025-10-14, 窗口期=3天");
        log.info("期望结果:");
        log.info("  步骤1: proc_date >= '20251007' AND proc_date <= '20251014' (原始范围，不加时间窗)");
        log.info("  步骤2: proc_date >= '20251007' AND proc_date <= '20251017' (原始+3天)");
        log.info("  步骤3: proc_date >= '20251007' AND proc_date <= '20251020' (原始+6天)");
        log.info("生成的SQL:");
        log.info(sql);
        
        // 验证每一步的时间范围
        boolean step1Correct = sql.contains("proc_date >= '20251007' AND proc_date <= '20251014'");
        boolean step2Correct = sql.contains("proc_date >= '20251007' AND proc_date <= '20251017'");
        boolean step3Correct = sql.contains("proc_date >= '20251007' AND proc_date <= '20251020'");
        
        log.info("验证结果:");
        log.info("  步骤1: {}", step1Correct ? "通过" : "失败");
        log.info("  步骤2: {}", step2Correct ? "通过" : "失败");
        log.info("  步骤3: {}", step3Correct ? "通过" : "失败");
        log.info("总体结果: {}", (step1Correct && step2Correct && step3Correct) ? "通过" : "失败");
        
        return sql;
    }
}
