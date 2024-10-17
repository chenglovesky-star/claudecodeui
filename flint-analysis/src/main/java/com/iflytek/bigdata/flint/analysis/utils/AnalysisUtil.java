package com.iflytek.bigdata.flint.analysis.utils;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.google.common.base.Joiner;
import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryHistory;
import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryHistoryWithBLOBs;
import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryResultWithBLOBs;
import com.iflytek.bigdata.flint.analysis.dto.EventDetailDto;
import com.iflytek.bigdata.flint.analysis.dto.EventRuleDto;
import com.iflytek.bigdata.flint.analysis.dto.ResultDto;
import com.iflytek.bigdata.flint.analysis.dto.ResultRowDto;
import com.iflytek.bigdata.flint.analysis.service.IImpalaQueryHistoryService;
import com.iflytek.bigdata.flint.analysis.service.IImpalaQueryResultService;
import com.iflytek.bigdata.flint.analysis.thread.*;
import com.iflytek.bigdata.flint.common.date.DateStyle;
import com.iflytek.bigdata.flint.common.date.DateUtil;
import com.iflytek.bigdata.flint.hiveserver2.config.AnalysisConfig;
import com.iflytek.bigdata.flint.hiveserver2.config.HiveConfig;
import com.iflytek.bigdata.flint.metadata.dao.model.*;
import com.iflytek.bigdata.flint.metadata.dto.ConditionDto;
import com.iflytek.bigdata.flint.metadata.dto.EventDto;
import com.iflytek.bigdata.flint.metadata.dto.EventPropertyDto;
import com.iflytek.bigdata.flint.metadata.dto.PropertyDto;
import com.iflytek.bigdata.flint.metadata.service.*;
import com.iflytek.bigdata.flint.metadata.utils.MetadataUtil;

import lombok.extern.log4j.Log4j2;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.collections.MapUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.DigestUtils;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;

/**
 * @Author: linlong
 * @Date: 2024/8/5
 * @Desc:
 */
@Component
@Log4j2
@ConfigurationProperties(prefix = "spring.hive")
@Configuration
public class AnalysisUtil {

    private final static String STARROCKS = "starRocks";

    private final static String CACHE_KEY = "metis:analysis:";

    private final static String ALL = "all";

    private final static String ALL_CN = "总体";
    private final static String GROUP_IDS_COLUMN = "group_ids";

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    @Resource
    private IOperationService iOperationService;

    @Resource
    private IImpalaQueryHistoryService iImpalaQueryHistoryService;

    @Resource
    private IImpalaQueryResultService iImpalaQueryResultService;

    @Resource
    private MetadataUtil metadataUtil;

    @Resource
    private IVirtualEventService iVirtualEventService;

    @Resource
    private IMetadataProfileColumnService iMetadataProfileColumnService;

    @Resource
    IMetadataEventPropertyService iMetadataEventPropertyService;

    @Resource
    private IDimColumnService iDimColumnService;

    @Resource
    private IDimService iDimService;

    @Resource
    private HiveConfig hiveConfig;

    @Resource
    private AnalysisConfig analysisConfig;
    private static final Logger logger = LoggerFactory.getLogger(AnalysisUtil.class);

    
    @Value("${APP_ENV:production}")
    private String env;

    @Value("${hive.engine:hive}")
    private String hiveEngine;

    private Set<String> commonPros() {
        return metadataUtil.getCommonPros();
    }

    public Map<String, String> stringVirtualEventMap() {
        return metadataUtil.getStringVirtualEventMap();
    }

    private Map<String, List<PropertyDto>> eventMap() {
        return metadataUtil.getEventMap();
    }

    private Map<String, Integer> typeMap() {
        return metadataUtil.getTypeMap();
    }


    public ImpalaQueryHistory createQuery(String operator, EventDetailDto eventDetailDto, Integer cache) {
        String times = eventDetailDto.getTimeValues();
        String[] tArr = times.split(",");
        Date begin = DateUtil.StringToDate(tArr[0], DateStyle.YYYY_MM_DD);
        Date end = DateUtil.StringToDate(tArr[1], DateStyle.YYYY_MM_DD);
        int days = DateUtil.getIntervalDays(begin, end);

        String requestJson = JSONObject.toJSONString(eventDetailDto);
        String engine = STARROCKS;

        String sql = getAnalysisQuerySql(eventDetailDto, engine);
        String md5SQL = DigestUtils.md5DigestAsHex(sql.getBytes(StandardCharsets.UTF_8));

        Date now = new Date();

        //cache=1:非强制刷新，查询历史揭露
        if (cache != 0) {
            Object cacheId = redisTemplate.opsForValue().get(CACHE_KEY + md5SQL);
            if (cacheId != null) {
                ImpalaQueryHistoryWithBLOBs cacheItem = iImpalaQueryHistoryService.selectById(Long.valueOf(cacheId.toString()));
                if (cacheItem != null && (cacheItem.getStatus() == AnalysisQueryStatusEnum.FINISHED.getIndex())) {
                    //根据 cache 新增 history和result
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
                //存在运行中一模一样的sql，默认当作同一个
                if (cacheItem != null && (cacheItem.getStatus() == AnalysisQueryStatusEnum.RUNNING.getIndex())) {
                    return cacheItem;
                }
            }
        }
        ImpalaQueryHistoryWithBLOBs item = new ImpalaQueryHistoryWithBLOBs();
        item.setUsername(operator);
        item.setQueryTime(now);
        item.setStartTime(now);
        item.setStatus(AnalysisQueryStatusEnum.RUNNING.getIndex());
        item.setQueryRequest(requestJson);
        item.setQuerySql(sql);
        iImpalaQueryHistoryService.insert(item);

        redisTemplate.opsForValue().set(CACHE_KEY + md5SQL, item.getId().toString(), 60, TimeUnit.MINUTES);

        ImpalaQueryResultWithBLOBs result = new ImpalaQueryResultWithBLOBs();
        result.setHistoryId(item.getId());
        result.setQuerySql(sql);
        result.setOriginResult("");
        iImpalaQueryResultService.insert(result);

        AnalysisQueryTask queryTask = new AnalysisQueryTask();
        queryTask.setQueryContent(sql);
        queryTask.setQueryHistoryId(item.getId());
        queryTask.setiImpalaQueryResultService(iImpalaQueryResultService);
        queryTask.setiImpalaQueryHistoryService(iImpalaQueryHistoryService);
        queryTask.setJdbcType(engine);
        queryTask.setHiveConfig(hiveConfig);
        String hiveEngine = this.hiveEngine;
        queryTask.setHiveEngine(hiveEngine);

        queryTask.run();
        return item;
    }

    private String getAnalysisQuerySql(EventDetailDto eventDetailDto, String engine) {
        // 是否按用户属性或者分群查看
        boolean groupByUser = false;
        // 是否按照维度表查看
        boolean groupByDim = false;
        Dim dim = null;
        String dimSelectColumn = "";
        List<String> userColumns = new ArrayList<>();
        List<String> querySqlList = new ArrayList<>();


        //时间处理
        String times = eventDetailDto.getTimeValues();
        String[] tArr = times.split(",");
        String start = DateUtil.StringToString(tArr[0], DateStyle.YYYY_MM_DD, DateStyle.YYYYMMDD);
        String end = DateUtil.StringToString(tArr[1], DateStyle.YYYY_MM_DD, DateStyle.YYYYMMDD);
        Date startT = DateUtil.StringToDate(start, DateStyle.YYYYMMDD);
        Date endT = DateUtil.StringToDate(end, DateStyle.YYYYMMDD);
        //整体时间条件限制
        String dateQuery = String.format(" and proc_date>='%s' and proc_date<='%s' ", start, end);

        Set<String> eventSelectSet = new HashSet<>();//优化埋点表选择列
        eventSelectSet.add("proc_date");//默认加入 proc_date
        eventSelectSet.add("opcode");//默认加入 opcode
        eventSelectSet.add("uid");//默认加入 uid

        List<String> groupBys = eventDetailDto.getGroupBy();

        String byValues = eventDetailDto.getByValues();
        JSONObject byJson = new JSONObject();
        if (StringUtils.isNotEmpty(byValues)) {
            JSONArray arr = JSONArray.parseArray(byValues);
            if (CollectionUtils.isNotEmpty(arr)) {
                for (int i = 0; i < arr.size(); i++) {
                    JSONObject item = arr.getJSONObject(i);
                    for (String key : item.keySet()) {
                        byJson.put(key, item.getString(key));
                    }
                }
            }
        }

        //按xxx查看处理
        String groupByQuery = ""; // group by 字段
        String selectGroupByQuery = ""; // group by 必须在 select 中
        List<String> finalSelectList = new ArrayList<>();//最终select的字段，提供给自定义指标使用
        List<String> selectGroupByList = new ArrayList<>();
        List<String> groupByList = new ArrayList<>();

        if (CollectionUtils.isNotEmpty(groupBys)) {
            Collections.sort(groupBys);
            for (String groupBy : groupBys) {
                if (ALL.equals(groupBy)) continue;
                //分段转换caseSql
                String values = "";
                if (byJson.containsKey(groupBy)) {
                    values = byJson.getString(groupBy);
                }
                if (groupBy.startsWith("D|")) {
                    String value = groupBy.substring(2);
                    Integer columnId = Integer.valueOf(value);
                    DimColumn dimColumn = iDimColumnService.selectById(columnId);
                    dim = iDimService.selectById(dimColumn.getDimId());
                    selectGroupByList.add("dim_column");
                    groupByList.add("dim_column");
                    finalSelectList.add("dim_column");
                    dimSelectColumn = ",d." + dimColumn.getName() + " as `dim_column`";
                    eventSelectSet.add("tags");
                    groupByDim = true;
                } else if (groupBy.startsWith("G|")) {
                    groupByUser = true;
                    String groupId = groupBy.substring(2);
                    groupBy = "if(json_array_contains_any(" + GROUP_IDS_COLUMN + ",'" + groupId + "'),'是','否')";
                    groupByList.add(groupBy);
                    selectGroupByList.add(groupBy + "as `G|" + groupId + "`");
                    finalSelectList.add("`G|" + groupId + "`");
                    userColumns.add(GROUP_IDS_COLUMN);
                } else if (groupBy.startsWith("U|")) {
                    groupByUser = true;
                    String profileColumn = groupBy.substring(2);
                    //分段转换caseSql
                    if (StringUtils.isNotEmpty(values)) {
                        MetadataProfileColumn columnInfo = iMetadataProfileColumnService.selectByName(profileColumn);
                        // 日期格式单独处理
                        String caseSql = "";
                        if (columnInfo != null && columnInfo.getType().equals("5")) {
                            caseSql = getCaseDateSql(profileColumn, values,"g_" + profileColumn);
                        } else {
                            caseSql = getCaseSql(profileColumn, values,"g_" + profileColumn);
                        }
                        //20230314 修复 group by case sql 问题
                        groupByList.add(getCaseSql(profileColumn, values));
                        finalSelectList.add("g_" + profileColumn);
                        selectGroupByList.add(caseSql);
                    } else {
                        selectGroupByList.add(profileColumn);
                        groupByList.add(profileColumn);
                        finalSelectList.add(profileColumn);
                    }
                    userColumns.add(profileColumn);

                } else if (groupBy.startsWith("C|") || groupBy.startsWith("$$")) {
                    if(groupBy == "C|d_newflag"){
                        groupBy = groupBy.substring(2);
                        eventSelectSet.add("tags");
                        //分段转换caseSql
                        if (StringUtils.isNotEmpty(values)) {
                            String caseSql = getCaseSql("cast(ifly_map_get(tags,'" + groupBy + "') as double)", values, groupBy);
                            String groupByCaseSql = getCaseSql("cast(ifly_map_get(tags,'" + groupBy + "') as double)", values);
                            selectGroupByList.add(caseSql);
                            groupByList.add(groupByCaseSql);
                        } else {
                            selectGroupByList.add("ifly_map_get(tags,'" + groupBy + "') as `" + groupBy + "`");
                            groupByList.add("ifly_map_get(tags,'" + groupBy + "')");
                        }
                        finalSelectList.add(groupBy);
                        } else{
                    groupBy = groupBy.substring(2);
                    if (commonPros().contains(groupBy)) {
                        eventSelectSet.add(groupBy);
                    }
                    //分段转换caseSql
                    if (StringUtils.isNotEmpty(values)) {
                        String caseSql = getCaseSql(groupBy, values, "g_" + groupBy);
                        selectGroupByList.add(caseSql);
                        //20230314 修复 group by case sql 问题
                        groupByList.add(getCaseSql(groupBy, values));
                        finalSelectList.add("g_" + groupBy);
                    } else {
                        selectGroupByList.add(groupBy);
                        groupByList.add(groupBy);
                        finalSelectList.add(groupBy);
                    }
                    }
                } else {
                    eventSelectSet.add("tags");
                    //分段转换caseSql
                    if (StringUtils.isNotEmpty(values)) {
                        String caseSql = getCaseSql("cast(ifly_map_get(tags,'" + groupBy + "') as double)", values, groupBy);
                        String groupByCaseSql = getCaseSql("cast(ifly_map_get(tags,'" + groupBy + "') as double)", values);
                        selectGroupByList.add(caseSql);
                        groupByList.add(groupByCaseSql);
                    } else {
                        selectGroupByList.add("ifly_map_get(tags,'" + groupBy + "') as `" + groupBy + "`");
                        groupByList.add("ifly_map_get(tags,'" + groupBy + "')");
                    }
                    finalSelectList.add(groupBy);
                }
            }
            if (CollectionUtils.isNotEmpty(selectGroupByList)) {
                selectGroupByQuery = " , " + Joiner.on(" , ").join(selectGroupByList);
            }
            if (CollectionUtils.isNotEmpty(groupByList)) {
                groupByQuery = " , " + Joiner.on(" , ").join(groupByList);
            }
        }

        Integer timeBucket = eventDetailDto.getTimeBucket();
        String timeFormat = " from_timestamp(time,'%s') ";
        switch (timeBucket) {
            case 0:
                timeFormat = "proc_date";
                break;
            case 1:
                timeFormat = String.format(timeFormat, "yyyy-MM-dd HH");
                eventSelectSet.add("starttime");
                break;
            case 2:
                timeFormat = String.format(timeFormat, "yyyy-MM-dd HH:mm");
                eventSelectSet.add("starttime");
                break;
            case 4:
                timeFormat = "substr(proc_date,1,6)";
                break;
            case 3:
                timeFormat = "date_trunc('week', time)";
                eventSelectSet.add("starttime");
                break;
            case 5:
                timeFormat = "'" + tArr[0] + "至" + tArr[1] + "'";
                break;
        }

        List<EventRuleDto> eventRuleDtos = eventDetailDto.getEventRules();
        for (EventRuleDto eventRuleDto : eventRuleDtos) {

            Integer countType = eventRuleDto.getCountType();
            if (countType != null) {
                //兼容性
                switch (countType) {
                    case 0:
                        eventRuleDto.setViewBy("count(1)");
                        break;
                    case 1:
                        eventRuleDto.setViewBy("count(distinct uid)");
                        break;
                    case 2:
                        eventRuleDto.setViewBy("count(1)/count(distinct uid)");
                        break;
                }
            } else {
                //修复 view by没有加入select的问题
                for (String commonPro : commonPros()) {
                    if (eventRuleDto.getViewBy().toLowerCase().contains(commonPro.toLowerCase())) {
                        eventSelectSet.add(commonPro);
                    }
                }
                if (eventRuleDto.getViewBy().toLowerCase().contains("tags")) {
                    eventSelectSet.add("tags");
                }
            }

            boolean joinUser = false;//是否按用户属性/分群过滤
            boolean joinDim = false;//是否有维度表join


            String countSql = " ," + eventRuleDto.getViewBy() + " as cnt ";
            StringBuffer sql = new StringBuffer();
            StringBuffer totalSql = new StringBuffer();
            //防止数据倾斜
            if (eventRuleDto.getViewBy().contains("distinct uid")) {
                sql.append(String.format("select %s as t %s %s from eventTable where uid is not null and uid!='' and uid!='-' %s", timeFormat, selectGroupByQuery, countSql, dateQuery));

                totalSql.append(String.format("select %s as t %s %s from eventTable where uid is not null and uid!='' and uid!='-' %s", "'合计'", selectGroupByQuery, countSql, dateQuery));
            } else {
                sql.append(String.format("select %s as t %s %s from eventTable where 1=1 %s", timeFormat, selectGroupByQuery, countSql, dateQuery));

                totalSql.append(String.format("select %s as t %s %s from eventTable where 1=1 %s", "'合计'", selectGroupByQuery, countSql, dateQuery));
            }

            String event = eventRuleDto.getEventName();
            if (StringUtils.isNotEmpty(event) && !ALL.equals(event)) {
                if (event.startsWith("V|")) {
                    String eventSql = stringVirtualEventMap().get(event);
                    if (StringUtils.isNotEmpty(eventSql)) {
                        //虚拟事件sql中是否包含公共属性
                        for (String commonPro : commonPros()) {
                            if (eventSql.contains(commonPro)) {
                                eventSelectSet.add(commonPro);
                            }
                        }
                        if (eventSql.contains("tags")) {
                            eventSelectSet.add("tags");
                        }
                        String eventQuery = String.format(" and ( %s ) ", eventSql);
                        sql.append(eventQuery);
                        totalSql.append(eventQuery);
                    } else {
                        throw new RuntimeException("虚拟事件包含的事件至少大于等于1个!");
                    }
                } else {
                    String eventQuery = String.format(" and opcode='%s' ", event);
                    sql.append(eventQuery);
                    totalSql.append(eventQuery);
                }
            }
            //全局过滤
            String globalSql = "";
            if (eventDetailDto.getGlobalFilter() != null && CollectionUtils.isNotEmpty(eventDetailDto.getGlobalFilter().getSubFilters())) {
                List<String> globalSqlList = new ArrayList<>();
                for (EventPropertyDto subFilter : eventDetailDto.getGlobalFilter().getSubFilters()) {
                    String propertyName = subFilter.getPropertyName();
                    ConditionDto conditionDto = new ConditionDto();
                    if (propertyName.startsWith("D|")) {
                        String value = propertyName.substring(2);
                        Integer columnId = Integer.valueOf(value);
                        DimColumn dimColumn = iDimColumnService.selectById(columnId);
                        conditionDto.setColumnName("dim_column");
                        conditionDto.setColumnType(typeMap().get(dimColumn.getType()));
                        joinDim = true;
                        dim = iDimService.selectById(dimColumn.getDimId());
                        dimSelectColumn = ",d." + dimColumn.getName() + " as dim_column";
                        eventSelectSet.add("tags");
                    } else if (propertyName.startsWith("G|")) {
                        String value = propertyName.substring(2);
                        String boolValue = subFilter.getPropertyOperationValue();
                        if ("true".equalsIgnoreCase(boolValue)) {
                            conditionDto.setOperationName("EqualTo");
                        } else {
                            conditionDto.setOperationName("NotEqualTo");
                        }
                        conditionDto.setOperationValue(value);
                        conditionDto.setColumnName(GROUP_IDS_COLUMN);
                        conditionDto.setColumnType(3);
                        joinUser = true;
                        userColumns.add(GROUP_IDS_COLUMN);
                    } else {
                        if (propertyName.startsWith("C|") || propertyName.startsWith("$$")) {
                            conditionDto.setColumnName(propertyName.substring(2));
                            eventSelectSet.add(propertyName.substring(2));
                        } else if (propertyName.startsWith("U|")) {
                            String profileColumn = propertyName.substring(2);
                            MetadataProfileColumn metadataProfileColumn = iMetadataProfileColumnService.selectByName(profileColumn);
                            conditionDto.setColumnType(Integer.valueOf(metadataProfileColumn.getType()));
                            if (profileColumn.startsWith("temp_tags")) {
                                profileColumn = "temp_tags";
                            }
                            conditionDto.setColumnName(profileColumn);
                            joinUser = true;
                            userColumns.add(conditionDto.getColumnName());
                        } else {
                            eventSelectSet.add("tags");
                            String column = "ifly_map_get(tags,'" + propertyName + "')";
                            conditionDto.setColumnName(column);
                        }
                    }
                    if (event.startsWith("V|")) {
                        event = event.substring(2);
                        VirtualEventWithBLOBs virtualEventWithBLOBs = iVirtualEventService.selectByName(event);
                        if (virtualEventWithBLOBs != null) {
                            List<EventDto> eventDtos = JSONArray.parseArray(virtualEventWithBLOBs.getEventFilter(), EventDto.class);
                            event = eventDtos.get(0).getEvent();
                        }
                    }
                    List<PropertyDto> list = eventMap().get(event);
                    if (list == null) {
                        list = new ArrayList<>();
                    }
                    String type = subFilter.getPropertyType();
                    if (StringUtils.isEmpty(type)) {
                        for (PropertyDto propertyDto : list) {
                            if (propertyDto.getName().equals(propertyName)) {
                                type = propertyDto.getType();
                                break;
                            }
                        }
                    }
                    if (StringUtils.isEmpty(type)) {
                        if (propertyName.startsWith("C|") || propertyName.startsWith("$$")) {
                            propertyName = propertyName.substring(2);
                        }
                        List<PropertyDto> commonList = metadataUtil.getCommonPropertyList();
                        for (PropertyDto propertyDto : commonList) {
                            if (propertyDto.getName().equals(propertyName)) {
                                type = propertyDto.getType();
                                break;
                            }
                        }
                    }
                    if (conditionDto.getColumnType() == null) {
                        conditionDto.setColumnType(typeMap().get(type));
                    }
                    Operation operation = iOperationService.selectById(subFilter.getPropertyOperationId());
                    if (StringUtils.isEmpty(conditionDto.getOperationName())) {
                        conditionDto.setOperationName(operation.getName());
                    }
                    if (StringUtils.isEmpty(conditionDto.getOperationValue())) {
                        conditionDto.setOperationValue(subFilter.getPropertyOperationValue());
                    }
                    //等于操作转换为包含
                    if (conditionDto.getOperationName().startsWith("Equal") && conditionDto.getOperationValue().contains(",")) {
                        conditionDto.setOperationName("ContainAny");
                    }
                    //时间比较转换
                    if (conditionDto.getOperationName().startsWith("Days")) {
                        conditionDto.setOperationName("Pdate" + conditionDto.getOperationName());
                    }
                    String subSql = metadataUtil.getSql(conditionDto);
                    globalSqlList.add(subSql);
                }
                Collections.sort(globalSqlList);
                globalSql = " (" + Joiner.on(" " + eventDetailDto.getGlobalFilter().getRelation() + " ").join(globalSqlList) + ") ";
            }
            List<String> subSqlList = new ArrayList<>();
            if (eventRuleDto.getFilter() != null && CollectionUtils.isNotEmpty(eventRuleDto.getFilter().getSubFilters())) {
                List<EventPropertyDto> eventPropertyDtos = eventRuleDto.getFilter().getSubFilters();
                for (EventPropertyDto subFilter : eventPropertyDtos) {
                    String propertyName = subFilter.getPropertyName();
                    ConditionDto conditionDto = new ConditionDto();
                    if (propertyName.startsWith("D|")) {
                        String value = propertyName.substring(2);
                        Integer columnId = Integer.valueOf(value);
                        DimColumn dimColumn = iDimColumnService.selectById(columnId);
                        conditionDto.setColumnName("dim_column");
                        conditionDto.setColumnType(typeMap().get(dimColumn.getType()));
                        joinDim = true;
                        dim = iDimService.selectById(dimColumn.getDimId());
                        dimSelectColumn = ",d." + dimColumn.getName() + " as dim_column";
                        eventSelectSet.add("tags");
                    } else if (propertyName.startsWith("G|")) {
                        String value = propertyName.substring(2);
                        String boolValue = subFilter.getPropertyOperationValue();
                        if ("true".equalsIgnoreCase(boolValue)) {
                            conditionDto.setOperationName("EqualTo");
                        } else {
                            conditionDto.setOperationName("NotEqualTo");
                        }
                        conditionDto.setOperationValue(value);
                        conditionDto.setColumnName(GROUP_IDS_COLUMN);
                        conditionDto.setColumnType(3);
                        joinUser = true;
                        userColumns.add(GROUP_IDS_COLUMN);
                    } else {
                        if (propertyName.startsWith("C|") || propertyName.startsWith("$$")) {
                            conditionDto.setColumnName(propertyName.substring(2));
                            eventSelectSet.add(propertyName.substring(2));
                        } else if (propertyName.startsWith("U|")) {
                            String profileColumn = propertyName.substring(2);
                            MetadataProfileColumn metadataProfileColumn = iMetadataProfileColumnService.selectByName(profileColumn);
                            conditionDto.setColumnType(Integer.valueOf(metadataProfileColumn.getType()));
                            if (profileColumn.startsWith("temp_tags")) {
                                profileColumn = "temp_tags";
                            }
                            conditionDto.setColumnName(profileColumn);
                            joinUser = true;
                            userColumns.add(conditionDto.getColumnName());
                        } else {
                            eventSelectSet.add("tags");
                            String column = "ifly_map_get(tags,'" + propertyName + "')";
                            conditionDto.setColumnName(column);
                        }
                    }
                    if (event.startsWith("V|")) {
                        event = event.substring(2);
                        VirtualEventWithBLOBs virtualEventWithBLOBs = iVirtualEventService.selectByName(event);
                        if (virtualEventWithBLOBs != null) {
                            List<EventDto> eventDtos = JSONArray.parseArray(virtualEventWithBLOBs.getEventFilter(), EventDto.class);
                            event = eventDtos.get(0).getEvent();
                        }
                    }
                    List<PropertyDto> list = eventMap().get(event);
                    if (list == null) {
                        list = new ArrayList<>();
                    }
                    String type = subFilter.getPropertyType();
                    if (StringUtils.isEmpty(type)) {
                        for (PropertyDto propertyDto : list) {
                            if (propertyDto.getName().equals(propertyName)) {
                                type = propertyDto.getType();
                                break;
                            }
                        }
                    }
                    if (StringUtils.isEmpty(type)) {
                        if (propertyName.startsWith("C|") || propertyName.startsWith("$$")) {
                            propertyName = propertyName.substring(2);
                        }
                        List<PropertyDto> commonList = metadataUtil.getCommonPropertyList();
                        for (PropertyDto propertyDto : commonList) {
                            if (propertyDto.getName().equals(propertyName)) {
                                type = propertyDto.getType();
                                break;
                            }
                        }
                    }
                    if (conditionDto.getColumnType() == null) {
                        conditionDto.setColumnType(typeMap().get(type));
                    }
                    Operation operation = iOperationService.selectById(subFilter.getPropertyOperationId());
                    if (StringUtils.isEmpty(conditionDto.getOperationName())) {
                        conditionDto.setOperationName(operation.getName());
                    }
                    if (StringUtils.isEmpty(conditionDto.getOperationValue())) {
                        conditionDto.setOperationValue(subFilter.getPropertyOperationValue());
                    }
                    //等于操作转换为包含
                    if (conditionDto.getOperationName().startsWith("Equal") && conditionDto.getOperationValue().contains(",")) {
                        conditionDto.setOperationName("ContainAny");
                    }
                    //时间比较转换
                    if (conditionDto.getOperationName().startsWith("Days")) {
                        conditionDto.setOperationName("Pdate" + conditionDto.getOperationName());
                    }
                    String subSql = metadataUtil.getSql(conditionDto);
                    if (subSql != null) {
                        subSqlList.add(subSql);
                    }
                }
                Collections.sort(subSqlList);
            }
            if (CollectionUtils.isNotEmpty(subSqlList) || StringUtils.isNotEmpty(globalSql)) {
                sql.append(" and (");
                totalSql.append(" and (");
                if (CollectionUtils.isNotEmpty(subSqlList)) {
                    sql.append(" (").append(Joiner.on(" " + eventRuleDto.getFilter().getRelation() + " ").join(subSqlList)).append(") ");
                    totalSql.append(" (").append(Joiner.on(" " + eventRuleDto.getFilter().getRelation() + " ").join(subSqlList)).append(") ");
                    if (StringUtils.isNotEmpty(globalSql)) {
                        sql.append(" and ").append(globalSql);
                        totalSql.append(" and ").append(globalSql);
                    }
                } else {
                    if (StringUtils.isNotEmpty(globalSql)) {
                        sql.append(globalSql);
                        totalSql.append(globalSql);
                    }
                }
                sql.append(") ");
                totalSql.append(") ");
            }
            sql.append(String.format(" group by %s %s", timeFormat, groupByQuery));
            totalSql.append(String.format(" group by %s %s", "'合计'", groupByQuery));

            String finalSql = "select * from ( " + sql + " union all " + totalSql + " ) ut";

            //累计不需要合计
            if (timeBucket == 5) {
                finalSql = sql.toString();
            }
            String lastPdate = DateUtil.DateToString(DateUtil.addDay(new Date(), -1), DateStyle.YYYY_MM_DD);

            //埋点视图表拼接
            String eventTable = "";
            eventTable = "( select " + Joiner.on(",").join(eventSelectSet) + " from " + analysisConfig.getEventsTable() + "  where 1=1 " + dateQuery + " ) events";

            if (groupByUser || joinUser) {
                Set<String> userColumnSet = new HashSet<>(userColumns);
                userColumnSet.remove("uid");//单独处理画像的属性user_id造成的冲突
                String selectUserColumns = "";
                if (CollectionUtils.isNotEmpty(userColumnSet)) {
                    selectUserColumns = "," + Joiner.on(",").join(userColumnSet);
                }
                String joinTable = " ( select  events.*" + selectUserColumns + " from " + eventTable + "  left join ( select uid" + selectUserColumns + " from " + analysisConfig.getProfileTable() + " ) u on events.uid = u.uid ) eu ";
                if (groupByDim || joinDim) {
                    String partitionWhere = StringUtils.isNotEmpty(dim.getPartition()) ? " where " + dim.getPartition() + "='" + lastPdate + "'" : "";
                    joinTable = " ( select  events.*" + selectUserColumns + dimSelectColumn + " from " + eventTable + "  left join ( select uid" + selectUserColumns + " from " + analysisConfig.getProfileTable() + " ) u on events.uid = u.uid  left join (select * from " + dim.getHiveTableName() + partitionWhere + ") d on d." + dim.getDimColumn() + "=ifly_map_get(events.tags,'" + dim.getProperty() + "')) eu ";
                }
                String[] arr = finalSql.split("eventTable");
                if (arr.length == 2) {
                    finalSql = arr[0] + joinTable + arr[1];
                }
                if (arr.length == 3) {
                    finalSql = arr[0] + joinTable + arr[1] + joinTable + arr[2];
                }
                if (arr.length == 4) {
                    finalSql = arr[0] + joinTable + arr[1] + joinTable + arr[2] + joinTable + arr[3];
                }
            } else {
                if (groupByDim || joinDim) {
                    String partitionWhere = StringUtils.isNotEmpty(dim.getPartition()) ? " where " + dim.getPartition() + "='" + lastPdate + "'" : "";
                    String joinTable = " ( select  events.*" + dimSelectColumn + " from " + eventTable + "  left join (select * from " + dim.getHiveTableName() + partitionWhere + ") d on d." + dim.getDimColumn() + "=ifly_map_get(events.tags,'" + dim.getProperty() + "')) eu ";
                    String[] arr = finalSql.split("eventTable");
                    if (arr.length == 2) {
                        finalSql = arr[0] + joinTable + arr[1];
                    }
                    if (arr.length == 3) {
                        finalSql = arr[0] + joinTable + arr[1] + joinTable + arr[2];
                    }
                    if (arr.length == 4) {
                        finalSql = arr[0] + joinTable + arr[1] + joinTable + arr[2] + joinTable + arr[3];
                    }
                }
            }

            finalSql = finalSql.replaceAll("eventTable", eventTable);
            //按xxx查看做排序
            if (CollectionUtils.isNotEmpty(groupByList)) {
                finalSql += " order by t asc,cnt desc";
            }
            querySqlList.add(finalSql);

        }

        String finalSql = Joiner.on(";").join(querySqlList);
        finalSql = DateUtil.replaceFormat(finalSql);
        return finalSql;
    }

    public ResultDto getResultByHistoryId(Long id, boolean b) {
        ImpalaQueryHistoryWithBLOBs impalaQueryHistory = iImpalaQueryHistoryService.selectById(id);
        ImpalaQueryResultWithBLOBs impalaQueryResult = iImpalaQueryResultService.selectByHistoryId(id);
        if (StringUtils.isEmpty(impalaQueryResult.getOriginResult())) return null;
        ResultDto resultDto = new ResultDto();
        EventDetailDto eventDetailDto = JSONObject.parseObject(impalaQueryHistory.getQueryRequest(), EventDetailDto.class);
        List<String> events = new ArrayList<>(); //事件或者指标
        List<Integer> countTypes = new ArrayList<>();//
        List<EventRuleDto> eventRules = eventDetailDto.getEventRules();
        ArrayList<String> byFieldsShowNameList = new ArrayList<>();
        for (EventRuleDto eventRule : eventRules) {
            if (StringUtils.isNotEmpty(eventRule.getEventAlias())) {
                events.add(eventRule.getEventAlias());
            } else {
                events.add(eventRule.getEventName());
            }
            countTypes.add(eventRule.getCountType());
        }
        resultDto.setEvents(events);
        resultDto.setCountTypes(countTypes);
        if (eventDetailDto.getGroupBy() == null) eventDetailDto.setGroupBy(Collections.singletonList(ALL));
        resultDto.setByFields(eventDetailDto.getGroupBy());
        List<List<Map<String, Object>>> result = JSONArray.parseObject(impalaQueryResult.getOriginResult().replaceAll("ut\\.", ""), List.class);
        List<Map<String, Object>> resultMapList = new ArrayList<>();
        Set<String> timeSet = new HashSet<>();
        Set<String> fieldSet = new LinkedHashSet<>();
        Map<String, String> aliasMap = new HashMap<>();
        if (CollectionUtils.isNotEmpty(eventDetailDto.getGroupBy())) {
            for (String byField : eventDetailDto.getGroupBy()) {
                if (byField.startsWith("C|")) byField = byField.substring(2);
                if (byField.startsWith("U|")) byField = byField.substring(2);
                if (byField.startsWith("D|")) byField = "dim_column";
                MetadataProfileColumn search = new MetadataProfileColumn();
                search.setName(byField);
                List<MetadataProfileColumn> list = iMetadataProfileColumnService.select(search);
                if (CollectionUtils.isNotEmpty(list)) {
                    MetadataProfileColumn metadataProfileColumn = list.get(0);
                    String enumValues = metadataProfileColumn.getEnumValues();
                    if (StringUtils.isNotEmpty(enumValues)) {
                        String[] enumValuesArr = enumValues.split(",");
                        for (int i = 0; i < enumValuesArr.length; i++) {
                            String enumV = enumValuesArr[i];
                            String[] enumVArr = enumV.split("=");
                            if (enumVArr.length < 2) {
                                continue;
                            }
                            aliasMap.put(byField + "_" + enumVArr[0], enumVArr[1]);
                        }
                    }
                }
            }
        }

        if (CollectionUtils.isNotEmpty(eventDetailDto.getGroupBy())) {
            for (String byField : eventDetailDto.getGroupBy()) {
                if (!byField.equals(ALL)) {
                    if (byField.startsWith("C|")) byField = byField.substring(2);
                    if (byField.startsWith("U|")) byField = byField.substring(2);
                    if (byField.startsWith("D|")) byField = "dim_column";
                    MetadataProfileColumn profileColumn = iMetadataProfileColumnService.selectByName(byField);
                    MetadataEventProperty metadataEventProperty = iMetadataEventPropertyService.selectByEventAndName("all", byField);
                    if (profileColumn != null) {
                        byFieldsShowNameList.add(profileColumn.getShowName());
                    } else if (metadataEventProperty != null) {
                        byFieldsShowNameList.add(metadataEventProperty.getShowName());
                    } else {
                        byFieldsShowNameList.add(byField);
                    }
                } else {
                    byFieldsShowNameList.add(byField);
                }
            }
            resultDto.setByFieldsShowName(byFieldsShowNameList);
        }
        for (List<Map<String, Object>> list : result) {
            Map<String, Object> resultMap = new HashMap<>();
            Map<String, Object> result1Map = new HashMap<>();
            Map<String, Object> result2Map = new HashMap<>();
            for (Map<String, Object> stringObjectMap : list) {
                String time = "";
                if (stringObjectMap.get("t") instanceof Long) {
                    time = DateUtil.DateToString(new Date((Long) stringObjectMap.get("t")), DateStyle.YYYY_MM_DD);
                } else {
                    time = (String) stringObjectMap.get("t");
                }
                if (time != null) {
                    timeSet.add(time);//时间维度
                }
                String key = time;

                Object cnt = 0;
                if (stringObjectMap.get("cnt") instanceof java.math.BigDecimal) {
                    cnt = ((java.math.BigDecimal) stringObjectMap.get("cnt")).floatValue();
                } else if (stringObjectMap.get("cnt") instanceof java.lang.Long) {
                    cnt = (Long) stringObjectMap.get("cnt");
                } else if (stringObjectMap.get("cnt") instanceof java.lang.String) {
                    cnt = (String) stringObjectMap.get("cnt");
                } else {
                    cnt = (Integer) stringObjectMap.get("cnt");
                }
                if (CollectionUtils.isNotEmpty(resultDto.getByFields())) {
                    List<String> filedValues = new ArrayList<>();
                    for (String byField : resultDto.getByFields()) {
                        if (byField.startsWith("C|")) byField = byField.substring(2);
                        if (byField.startsWith("U|")) byField = byField.substring(2);
                        if (byField.startsWith("D|")) byField = "dim_column";
                        if (ALL.equals(byField)) {
                            filedValues.add(ALL_CN);
                        } else {
                            if (stringObjectMap.get(byField) != null) {
                                String dim = byField + "_" + stringObjectMap.get(byField).toString();
                                if (MapUtils.isNotEmpty(aliasMap) && aliasMap.containsKey(dim)) {
                                    filedValues.add(aliasMap.get(dim));
                                } else {
                                    filedValues.add(stringObjectMap.get(byField).toString());
                                }
                            } else if (stringObjectMap.get("g_" + byField) != null) {
                                String dim = byField + "_" + stringObjectMap.get("g_" + byField).toString();
                                if (MapUtils.isNotEmpty(aliasMap) && aliasMap.containsKey(dim)) {
                                    filedValues.add(aliasMap.get(dim));
                                } else {
                                    filedValues.add(stringObjectMap.get("g_" + byField).toString());
                                }
                            } else if (stringObjectMap.get(byField.toLowerCase()) != null) {
                                //防止hive转小写
                                String dim = byField + "_" + stringObjectMap.get(byField.toLowerCase());
                                if (MapUtils.isNotEmpty(aliasMap) && aliasMap.containsKey(dim)) {
                                    filedValues.add(aliasMap.get(dim));
                                } else {
                                    filedValues.add((String) stringObjectMap.get(byField.toLowerCase()));
                                }
                            } else if (stringObjectMap.get("g_" + byField.toLowerCase()) != null) {
                                String dim = byField + "_" + stringObjectMap.get(byField.toLowerCase());
                                if (MapUtils.isNotEmpty(aliasMap) && aliasMap.containsKey(dim)) {
                                    filedValues.add(aliasMap.get(dim));
                                } else {
                                    filedValues.add((String) stringObjectMap.get(byField.toLowerCase()));
                                }
                            } else {
                                filedValues.add("NULL");
                            }
                        }
                    }
                    String fieldKey = Joiner.on("#").join(filedValues);
                    fieldSet.add(fieldKey);//维度值
                    key += "#" + fieldKey;
                }
                resultMap.put(key, cnt);
            }
            resultMapList.add(resultMap);
        }
        List<String> series = new ArrayList<String>(timeSet);
        Collections.sort(series);
        resultDto.setSeries(series);
        List<String> fields = new ArrayList<String>(fieldSet);
        //Collections.sort(fields);
        List<ResultRowDto> resultRowDtos = new ArrayList<>();
        if (fields.size() >= 100) { //限制了返回的数量
            fields = fields.subList(0, 100);
            resultDto.setFull(false);
        } else {
            resultDto.setFull(true);
        }
        for (String field : fields) {
            ResultRowDto row = new ResultRowDto();
            row.setByValues(Arrays.asList(field.split("#")));
            List<List<Object>> values = new ArrayList<>();
            row.setValues(values);
            for (String time : series) {
                List<Object> intValues = new ArrayList<>();
                for (Map<String, Object> stringIntegerMap : resultMapList) {
                    Object cnt = stringIntegerMap.get(time + "#" + field);
                    intValues.add(cnt == null ? 0 : cnt);
                }
                values.add(intValues);
            }
            resultRowDtos.add(row);
        }
        if (eventDetailDto.getTimeBucket() == 0) {
            List<String> newSeries = new ArrayList<>();
            for (String day : series) {
                if (!"合计".equalsIgnoreCase(day)) {
                    newSeries.add(DateUtil.StringToString(day, DateStyle.YYYYMMDD, DateStyle.YYYY_MM_DD));
                } else {
                    newSeries.add(day);
                }
            }
            resultDto.setSeries(newSeries);
        }
        if (eventDetailDto.getTimeBucket() == 3) {
            List<String> newSeries = new ArrayList<>();
            for (String week : series) {
                String[] arrs = week.split(" ");
                newSeries.add(arrs[0]);
            }
            resultDto.setSeries(newSeries);
        }
        resultDto.setRows(resultRowDtos);
        return resultDto;
    }


    private void getCsvContent(PrintWriter writer, Long id) {
        ResultDto resultDto = getResultByHistoryId(id, true);
        StringBuffer header = new StringBuffer("日期时间,");
        header.append(Joiner.on(",").join(resultDto.getByFields()));
        for (int i = 0; i < resultDto.getEvents().size(); i++) {
            header.append(",").append(resultDto.getEvents().get(i) + "的值");
        }
        writer.println(header);
        for (int j = 0; j < resultDto.getSeries().size(); j++) {
            for (int i = 0; i < resultDto.getRows().size(); i++) {
                ResultRowDto resultRowDto = resultDto.getRows().get(i);
                StringBuffer line = new StringBuffer();
                line.append(resultDto.getSeries().get(j)).append(",");
                line.append(Joiner.on(",").join(resultRowDto.getByValues())).append(",");
                line.append(Joiner.on(",").join(resultRowDto.getValues().get(j)));
                writer.println(line);
            }
        }
    }

    public void exportQueryResult(HttpServletResponse response, Long id) {

        PrintWriter writer = null;
        try {
            response.setContentType("application/octet-stream;charset=gbk");

            String headerValue = String.format("attachment; filename=\"%s\"", String.format("事件分析结果-%s.csv", id.toString()));
            response.setHeader("Content-Disposition", headerValue);
            response.setCharacterEncoding("GBK");
            writer = response.getWriter();
            getCsvContent(writer, id);
            writer.flush();
        } catch (IOException e) {
            e.printStackTrace();
        } finally {
            if (writer != null) writer.close();
            try {
                response.flushBuffer();
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
    }

    public List<PropertyDto> groupByPropertyList(String events) {

        return metadataUtil.groupByPropertyList(events);
    }

    private String getCaseDateSql(String column, String values, String asName) {
        List<String> valueList = new ArrayList<>();
        String[] arr = values.split(",");
        for (String v : arr) {
            valueList.add(v);
        }
        Collections.sort(valueList);
        Collections.reverse(valueList);
        String caseSql = "case ";
        String caseWhen = "when %s >= %s then '%s' ";
        for (int i = 0; i < valueList.size(); i++) {
            String current = valueList.get(i);
            String text = "";
            if (i == 0) {
                text = current + "及以上";
            } else {
                String last = valueList.get(i - 1);
                text = current + "至" + last + "(不包含)";
            }
            caseSql += String.format(caseWhen, column, "'" + current + "'", text);
        }
        String smallest = valueList.get(valueList.size() - 1);
        caseSql += "else '" + smallest + "以下' end as `" + asName + "`";
        return caseSql;
    }

    private String getCaseDateSql(String column, String values) {
        List<String> valueList = new ArrayList<>();
        String[] arr = values.split(",");
        for (String v : arr) {
            valueList.add(v);
        }
        Collections.sort(valueList);
        Collections.reverse(valueList);
        String caseSql = "case ";
        String caseWhen = "when %s >= %s then '%s' ";
        for (int i = 0; i < valueList.size(); i++) {
            String current = valueList.get(i);
            String text = "";
            if (i == 0) {
                text = current + "及以上";
            } else {
                String last = valueList.get(i - 1);
                text = current + "至" + last + "(不包含)";
            }
            caseSql += String.format(caseWhen, column, "'" + current + "'", text);
        }
        String smallest = valueList.get(valueList.size() - 1);
        caseSql += "else '" + smallest + "以下' end ";
        return caseSql;
    }

    private String getCaseSql(String column, String values, String asName) {
        List<Double> valueList = new ArrayList<>();
        String[] arr = values.split(",");
        for (String v : arr) {
            valueList.add(Double.valueOf(v));
        }
        Collections.sort(valueList);
        Collections.reverse(valueList);
        String caseSql = "case ";
        caseSql += String.format("when %s is NULL then '未知' ", column);
        String caseWhen = "when %s >= %s then '%s' ";
        for (int i = 0; i < valueList.size(); i++) {
            Double current = valueList.get(i);
            String text = "";
            if (i == 0) {
                text = current + "及以上";
            } else {
                Double last = valueList.get(i - 1);
                text = current + "至" + last + "(不包含)";
            }
            caseSql += String.format(caseWhen, column, current, text);
        }
        Double smallest = valueList.get(valueList.size() - 1);
        caseSql += "else '" + smallest + "以下' end as `" + asName + "`";
        return caseSql;
    }

    private String getCaseSql(String column, String values) {
        List<Double> valueList = new ArrayList<>();
        String[] arr = values.split(",");
        for (String v : arr) {
            valueList.add(Double.valueOf(v));
        }
        Collections.sort(valueList);
        Collections.reverse(valueList);
        String caseSql = "case ";
        caseSql += String.format("when %s is NULL then '未知' ", column);
        String caseWhen = "when %s >= %s then '%s' ";
        for (int i = 0; i < valueList.size(); i++) {
            Double current = valueList.get(i);
            String text = "";
            if (i == 0) {
                text = current + "及以上";
            } else {
                Double last = valueList.get(i - 1);
                text = current + "至" + last + "(不包含)";
            }
            caseSql += String.format(caseWhen, column, current, text);
        }
        Double smallest = valueList.get(valueList.size() - 1);
        caseSql += "else '" + smallest + "以下' end ";
        return caseSql;
    }


}
