package com.iflytek.bigdata.flint.metadata.utils;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.google.common.base.CaseFormat;
import com.google.common.base.Joiner;
import com.iflytek.bigdata.flint.common.date.DateStyle;
import com.iflytek.bigdata.flint.common.date.DateUtil;
import com.iflytek.bigdata.flint.common.dto.Response;
import com.iflytek.bigdata.flint.common.http.OkHttpUtil;
import com.iflytek.bigdata.flint.common.http.RequestPair;
import com.iflytek.bigdata.flint.metadata.dao.model.*;
import com.iflytek.bigdata.flint.metadata.dto.*;
import com.iflytek.bigdata.flint.metadata.service.*;
import lombok.extern.log4j.Log4j2;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.annotation.PostConstruct;
import javax.annotation.Resource;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Component
@Log4j2
public class MetadataUtil {

    private final static String ALL = "all";

    private final static String STRING = "string";

    private final static String MAP = "map";

    @Resource
    private IMetadataEventPropertyService iMetadataEventPropertyService;

    @Resource
    private IMetadataEventService iMetadataEventService;

    @Value("${common.properties:uid string,version string,df string,imei string,imsi string,ip string,country string,province string,city string,brand string,model string,submodel string,os string,resolution string,starttime string,endtime string,ctm string,bizid string,osid string,ifly_map_get(tags,'d_newflag') string}")
    private String commonProperties;

    @Resource
    private IOperationService iOperationService;

    @Resource
    private IVirtualEventService iVirtualEventService;

    @Resource
    private IMetadataProfileColumnService iMetadataProfileColumnService;

    @Resource
    private IDimService iDimService;

    @Resource
    private IMetadataEventPropertyValueService iMetadataEventPropertyValueService;

    @Value("${marmot.url.time.ms:60000}")
    private long marmotTimeMS;

    @Value("${marmot.host:http://marmot.http.svc.dev.iflytek}")
    private String marmotHost;

    @Value("${artemis.url:http://172.16.2.110:28872/iflytek/artemis/v1/unCleanExperiments}")
    private String artemisUrl;

    @Value("${portrait.host:http://172.16.2.110:11055}")
    private String portraitHost;

    @Value("${artemis.host:http://172.16.2.110:28872}")
    private String artemisHost;

    @Value("${week.blacklist:#{null}}")
    private String weekBlackList;

    @Value("${artemis.groups.url:http://172.16.2.110:28872/iflytek/artemis/v1/expGroupsByExpId}")
    private String expGroupsUrl;

    private volatile Map<String, List<PropertyDto>> eventMap = new ConcurrentHashMap<>();

    private volatile List<String> events = new ArrayList<>();

    private volatile Map<String, Integer> typeMap = new ConcurrentHashMap<>();

    private volatile Map<Integer, String> typeMap2 = new ConcurrentHashMap<>();

    private volatile Set<String> commonPros = new HashSet<>();

    private volatile Set<String> blackSet = new HashSet<>();

    private volatile Map<String, String> commonMap = new ConcurrentHashMap<>();

    private volatile Map<String, String> artemisLabelMap = new ConcurrentHashMap<>();

    private volatile Map<String, String> stringVirtualEventMap = new ConcurrentHashMap<>();

    private volatile Map<String, String> mapVirtualEventMap = new ConcurrentHashMap<>();

    @PostConstruct
    public void init() {
        //埋点属性类型和平台类型对应
        typeMap.put("string", 2);
        typeMap.put("bool", 6);
        typeMap.put("boolean", 6);
        typeMap.put("number", 1);
        typeMap.put("long", 0);
        typeMap.put("double", 0);
        typeMap.put("list", 3);
        typeMap.put("map", 4);
        typeMap.put("int", 0);
        typeMap.put("datetime", 5);
        typeMap.put("array", 5);

        typeMap2.put(0, "int");
        typeMap2.put(1, "double");
        typeMap2.put(2, "string");
        typeMap2.put(3, "list");
        typeMap2.put(4, "map");
        typeMap2.put(5, "datetime");
        typeMap2.put(6, "boolean");
        if (StringUtils.isNotEmpty(weekBlackList)) {
            String[] arrs = weekBlackList.split(",");
            for (String arr : arrs) {
                blackSet.add(arr);
            }
        }

        if (StringUtils.isNotEmpty(commonProperties)) {
            for (String cp : commonProperties.split(",")) {
                String[] arrs = cp.split(" ");
                commonMap.put(arrs[0], arrs[1]);
                commonPros.add(arrs[0]);
            }
        }
        initConf();
//        initArtemis();
        Timer timer = new Timer(true);
        timer.schedule(new TimerTask() {

            @Override
            public void run() {
                try {
                    initConf();
//                    initArtemis();
                } catch (Exception e) {
                    log.error(e.getMessage());
                }
            }
        }, marmotTimeMS, marmotTimeMS);
    }

    private void initArtemis() {
        try {
            String result = OkHttpUtil.get(artemisUrl, null);
            JSONObject json = JSONObject.parseObject(result);
            if (json.getInteger("code") == 0) {
                JSONArray array = json.getJSONArray("data");
                if (CollectionUtils.isNotEmpty(array)) {
                    for (Object o : array) {
                        artemisLabelMap.put("E" + ((JSONObject) o).getInteger("expId"), "string");
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void initConf() {
        try {
            MetadataEventProperty metadataEventProperty = new MetadataEventProperty();
            List<MetadataEventProperty> eventPropertyList = iMetadataEventPropertyService.select(metadataEventProperty);
            Map<String, List<PropertyDto>> map = new HashMap<>();
            List<String> list = new ArrayList<>();
            for (int i = 0; i < eventPropertyList.size(); i++) {
                MetadataEventProperty item = eventPropertyList.get(i);
                String eventName = item.getEventName();
                // 事件名称
                String name = item.getName();
                String type = item.getType();
                PropertyDto propertyDto = new PropertyDto();
                propertyDto.setName(name);
                propertyDto.setType(type);

                if (map.containsKey(eventName)) {
                    map.get(eventName).add(propertyDto);
                } else {
                    List<PropertyDto> propertyDtos =  new ArrayList<>();
                    propertyDtos.add(propertyDto);
                    map.put(eventName, propertyDtos);
                    list.add(eventName);
                }
            }
            eventMap = map;
            events = list;

            List<VirtualEventWithBLOBs> virtualEvents = iVirtualEventService.select(null);
            if (CollectionUtils.isNotEmpty(virtualEvents)) {
                for (VirtualEventWithBLOBs virtualEvent : virtualEvents) {
                    events.add("V|" + virtualEvent.getName());
                    if (StringUtils.isNotEmpty(virtualEvent.getEventFilter())) {
                        List<EventDto> events = JSONArray.parseArray(virtualEvent.getEventFilter(), EventDto.class);
                        stringVirtualEventMap.put("V|" + virtualEvent.getName(), getEventSql(events, STRING));
                        mapVirtualEventMap.put("V|" + virtualEvent.getName(), getEventSql(events, MAP));
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public List<Operation> propertyOperationList(String type) {
        if (StringUtils.isEmpty(type)) {
            return null;
        }
        return columnOperationList(typeMap.get(type));
    }

    private List<Operation> columnOperationList(Integer columnType) {
        Operation item = new Operation();
        item.setColumnType(columnType);
        return iOperationService.select(item);
    }

    public List<PropertyDto> groupByPropertyList(String events) {
        List<PropertyDto> propertyDtos = new ArrayList<>();
        for (Map.Entry<String, String> stringStringEntry : commonMap.entrySet()) {
            PropertyDto propertyDto = new PropertyDto();
            propertyDto.setName(stringStringEntry.getKey());
            propertyDto.setType(stringStringEntry.getValue());
            propertyDtos.add(propertyDto);
        }

        if (StringUtils.isNotEmpty(events)) {
            List<String> eventList = Arrays.asList(events.split(","));
            if (!eventList.contains(ALL)) {
                Set<String> eventSet = new HashSet<String>(eventList);
                if (eventSet.size() == 1) {
                    propertyDtos.addAll(eventMap.get(new ArrayList<String>(eventSet).get(0)));
                }
            }
        }
        return propertyDtos;
    }

    public Map<String, List<PropertyDto>> getEventMap() {
        return eventMap;
    }

    public Map<String, Integer> getTypeMap() {
        return typeMap;
    }

    public Set<String> getCommonPros() {
        return commonPros;
    }

    public Map<String, String> getArtemisLabelMap() {
        return artemisLabelMap;
    }

    public Map<String, String> getStringVirtualEventMap() {
        return stringVirtualEventMap;
    }

    public Map<String, String> getCommonProsMap() {
        return commonMap;
    }

    public String getEventSql(List<EventDto> events) {
//        return getEventSql(events, STRING) + " | " + getEventSql(events, MAP) + " | " + getEventUnionSql(events, STRING)
//                + " | " + getEventUnionSql(events, MAP);

        return  getEventSql(events, STRING);
    }

    public String getEventSql(List<EventDto> events, String propertyType) {
        Set<String> eventSet = new HashSet<>();
        Set<String> inSet = new HashSet<>();
        String eventSql = "";
        Boolean hasFilter = false;
        if (CollectionUtils.isNotEmpty(events)) {
            for (EventDto event : events) {
                if (event.getFilter() != null && CollectionUtils.isNotEmpty(event.getFilter().getSubFilters())) {
                    hasFilter = true;
                } else {
                    inSet.add("'" + event.getEvent() + "'");
                }
                eventSet.add("'" + event.getEvent() + "'");
            }
            eventSql += String.format(" opcode in (%s) ", Joiner.on(",").join(eventSet));
            if (hasFilter) {
                List<String> eventSqlList = new ArrayList<>();
                if (CollectionUtils.isNotEmpty(inSet)) {
                    eventSqlList.add(String.format(" opcode in (%s) ", Joiner.on(",").join(inSet)));
                }
                for (EventDto event : events) {
                    String filterSql = String.format(" opcode = '%s'", event.getEvent());
                    if (CollectionUtils.isNotEmpty(event.getFilter().getSubFilters())) {
                        List<String> subSqlList = new ArrayList<>();
                        for (EventPropertyDto subFilter : event.getFilter().getSubFilters()) {
                            String propertyName = subFilter.getPropertyName();
                            ConditionDto conditionDto = new ConditionDto();
                            if (propertyName.startsWith("G|")) continue;
                            if (propertyName.startsWith("C|") || propertyName.startsWith("$$")) {
                                conditionDto.setColumnName(propertyName.substring(2));
                            } else {
                                if (STRING.equalsIgnoreCase(propertyType)) {
                                    conditionDto.setColumnName("ifly_map_get(tags,'" + propertyName + "')");
                                } else {
                                    conditionDto.setColumnName("properties['" + propertyName + "']");
                                }
                            }
                            List<PropertyDto> list = eventMap.get(event.getEvent());
                            if (CollectionUtils.isNotEmpty(list)) {
                                for (Map.Entry<String, String> stringStringEntry : artemisLabelMap.entrySet()) {
                                    PropertyDto propertyDto = new PropertyDto();
                                    propertyDto.setName(stringStringEntry.getKey());
                                    propertyDto.setType(stringStringEntry.getValue());
                                    list.add(propertyDto);
                                }
                            }
                            String type = subFilter.getPropertyType();
                            if (StringUtils.isEmpty(type)) {
                                if (CollectionUtils.isNotEmpty(list)) {
                                    for (PropertyDto propertyDto : list) {
                                        if (propertyDto.getName().equals(propertyName)) type = propertyDto.getType();
                                    }
                                }
                            }
                            if (StringUtils.isEmpty(type)) {
                                if (propertyName.startsWith("C|") || propertyName.startsWith("$$")) {
                                    propertyName = propertyName.substring(2);
                                }
                                List<PropertyDto> commonList = getCommonPropertyList();
                                for (PropertyDto propertyDto : commonList) {
                                    if (propertyDto.getName().equals(propertyName)) {
                                        type = propertyDto.getType();
                                        break;
                                    }
                                }
                            }
                            if (StringUtils.isEmpty(type)) {
                                type = "string";
                            }
                            conditionDto.setColumnType(typeMap.get(type));
                            Operation operation = iOperationService.selectById(subFilter.getPropertyOperationId());
                            conditionDto.setOperationName(operation.getName());
                            conditionDto.setColumnType(operation.getColumnType());
                            conditionDto.setOperationValue(subFilter.getPropertyOperationValue());
                            //等于操作转换为包含
                            if (conditionDto.getOperationName().startsWith("Equal") && conditionDto.getOperationValue().contains(",")) {
                                conditionDto.setOperationName("ContainAny");
                            }
                            String subSql = getSql(conditionDto);
                            subSqlList.add(subSql);
                        }
                        Collections.sort(subSqlList);
                        filterSql += String.format(" and ( %s ) ",
                                Joiner.on(" " + event.getFilter().getRelation() + " ").join(subSqlList));
                        eventSqlList.add("(" + filterSql + ")");
                    }
                }
                eventSql += String.format(" and ( %s )", Joiner.on(" or ").join(eventSqlList));
            }
        }
        return eventSql;
    }

    public String getEventUnionSql(List<EventDto> events, String propertyType) {
        String eventUnionSql = "";
        if (CollectionUtils.isNotEmpty(events)) {
            List<String> eventSqlList = new ArrayList<>();
            for (EventDto event : events) {
                String filterSql = String.format(" event = '%s'", event.getEvent());
                if (event.getFilter() != null && CollectionUtils.isNotEmpty(event.getFilter().getSubFilters())) {
                    if (CollectionUtils.isNotEmpty(event.getFilter().getSubFilters())) {
                        List<String> subSqlList = new ArrayList<>();
                        for (EventPropertyDto subFilter : event.getFilter().getSubFilters()) {
                            String propertyName = subFilter.getPropertyName();
                            ConditionDto conditionDto = new ConditionDto();
                            if (propertyName.startsWith("G|")) continue;
                            if (propertyName.startsWith("C|") || propertyName.startsWith("$$")) {
                                conditionDto.setColumnName(propertyName.substring(2));
                            } else {
                                if (STRING.equalsIgnoreCase(propertyType)) {
                                    conditionDto.setColumnName("ifly_map_gettagss,'" + propertyName + "')");
                                } else {
                                    conditionDto.setColumnName("properties['" + propertyName + "']");
                                }
                            }
                            List<PropertyDto> list = eventMap.get(event.getEvent());
                            if (CollectionUtils.isNotEmpty(list)) {
                                for (Map.Entry<String, String> stringStringEntry : artemisLabelMap.entrySet()) {
                                    PropertyDto propertyDto = new PropertyDto();
                                    propertyDto.setName(stringStringEntry.getKey());
                                    propertyDto.setType(stringStringEntry.getValue());
                                    list.add(propertyDto);
                                }
                            }
                            String type = subFilter.getPropertyType();
                            if (StringUtils.isEmpty(type) && CollectionUtils.isNotEmpty(list)) {
                                for (PropertyDto propertyDto : list) {
                                    if (propertyDto.getName().equals(propertyName)) type = propertyDto.getType();
                                }
                            }
                            if (StringUtils.isEmpty(type)) {
                                if (propertyName.startsWith("C|") || propertyName.startsWith("$$")) {
                                    propertyName = propertyName.substring(2);
                                }
                                List<PropertyDto> commonList = getCommonPropertyList();
                                for (PropertyDto propertyDto : commonList) {
                                    if (propertyDto.getName().equals(propertyName)) {
                                        type = propertyDto.getType();
                                        break;
                                    }
                                }
                            }
                            if (StringUtils.isEmpty(type)) {
                                type = "string";
                            }
                            conditionDto.setColumnType(typeMap.get(type));
                            Operation operation = iOperationService.selectById(subFilter.getPropertyOperationId());
                            conditionDto.setOperationName(operation.getName());
                            conditionDto.setColumnType(operation.getColumnType());
                            conditionDto.setOperationValue(subFilter.getPropertyOperationValue());
                            //等于操作转换为包含
                            if (conditionDto.getOperationName().startsWith("Equal") && conditionDto.getOperationValue().contains(",")) {
                                conditionDto.setOperationName("ContainAny");
                            }
                            String subSql = getSql(conditionDto);
                            subSqlList.add(subSql);
                        }
                        Collections.sort(subSqlList);
                        filterSql += String.format(" and ( %s ) ",
                                Joiner.on(" " + event.getFilter().getRelation() + " ").join(subSqlList));
                    }
                }
                eventSqlList.add("(" + filterSql + ")");
            }
            eventUnionSql = Joiner.on(" # ").join(eventSqlList);
        }
        return eventUnionSql;
    }

    public String getSql(ConditionDto conditionDto) {
        switch (conditionDto.getOperationName()) {
            case "GreaterThan":
                return getCompare1Sql(conditionDto.getColumnName(), ">", conditionDto.getOperationValue(),
                        conditionDto.getColumnType());
            case "GreaterThanOrEqualTo":
                return getCompare1Sql(conditionDto.getColumnName(), ">=", conditionDto.getOperationValue(),
                        conditionDto.getColumnType());
            case "LessThan":
                return getCompare1Sql(conditionDto.getColumnName(), "<", conditionDto.getOperationValue(),
                        conditionDto.getColumnType());
            case "LessThanOrEqualTo":
                return getCompare1Sql(conditionDto.getColumnName(), "<=", conditionDto.getOperationValue(),
                        conditionDto.getColumnType());
            case "Between":
                String[] values = conditionDto.getOperationValue().split(",");
                return getCompare2Sql(conditionDto.getColumnName(), values[0], values[1], conditionDto.getColumnType());
            case "Equal":
            case "EqualTo":
                return getCompare1Sql(conditionDto.getColumnName(), "=", conditionDto.getOperationValue(),
                        conditionDto.getColumnType());
            case "NotEqual":
            case "NotEqualTo":
                return getCompare1Sql(conditionDto.getColumnName(), "<>", conditionDto.getOperationValue(),
                        conditionDto.getColumnType());
            case "Null":
                return getNullSql(conditionDto.getColumnName(), conditionDto.getColumnType());
            case "NotNull":
                return getNotNullSql(conditionDto.getColumnName(), conditionDto.getColumnType());
            case "Like":
                if (conditionDto.getOperationValue().contains(",")) {
                    String[] arr = conditionDto.getOperationValue().split(",");
                    List<String> likeQuery = new ArrayList<>();
                    for (String likeValue : arr) {
                        if (!likeValue.contains("%")) {
                            likeValue = "%" + likeValue + "%";
                        }
                        likeQuery.add(getCompare1Sql(conditionDto.getColumnName(), "like", likeValue,
                                conditionDto.getColumnType()));
                    }
                    return " (" + Joiner.on(" or ").join(likeQuery) + ") ";
                } else {
                    String likeValue = conditionDto.getOperationValue();
                    if (!likeValue.contains("%")) {
                        likeValue = "%" + likeValue + "%";
                    }
                    return getCompare1Sql(conditionDto.getColumnName(), "like",
                            likeValue, conditionDto.getColumnType());
                }
            case "NotLike":
                if (conditionDto.getOperationValue().contains(",")) {
                    String[] arr = conditionDto.getOperationValue().split(",");
                    List<String> likeQuery = new ArrayList<>();
                    for (String likeValue : arr) {
                        if (!likeValue.contains("%")) {
                            likeValue = "%" + likeValue + "%";
                        }
                        likeQuery.add(getCompare1Sql(conditionDto.getColumnName(), "not like", likeValue,
                                conditionDto.getColumnType()));
                    }
                    return " (" + Joiner.on(" and ").join(likeQuery) + ") ";
                } else {
                    String likeValue = conditionDto.getOperationValue();
                    if (!likeValue.contains("%")) {
                        likeValue = "%" + likeValue + "%";
                    }
                    return getCompare1Sql(conditionDto.getColumnName(), "not like",
                            likeValue, conditionDto.getColumnType());
                }
            case "ContainAll":
                return getContainAllSql(conditionDto.getColumnName(), conditionDto.getOperationValue(),
                        conditionDto.getColumnType());
            case "ContainAny":
                return getContainAnySql(conditionDto.getColumnName(), conditionDto.getOperationValue(),
                        conditionDto.getColumnType());
            case "NotContainAny":
                return getNotContainAnySql(conditionDto.getColumnName(), conditionDto.getOperationValue(),
                        conditionDto.getColumnType());
            case "DaysBefore":
                Integer valueDateBefore = Integer.valueOf(conditionDto.getOperationValue());
                String compareDateBefore = String.format("${-%s day#yyyy-MM-dd}", valueDateBefore + "");
                return getCompare1Sql(conditionDto.getColumnName(), "<", compareDateBefore,
                        conditionDto.getColumnType());
            case "DaysIn":
                Integer valueDateIn = Integer.valueOf(conditionDto.getOperationValue());
                String compareDateIn1 = String.format("${-%s day#yyyy-MM-dd}", valueDateIn + "");
                String compareDateIn2 = String.format("${+%s day#yyyy-MM-dd}", valueDateIn + "");
                return getCompare2Sql(conditionDto.getColumnName(), compareDateIn1, compareDateIn2,
                        conditionDto.getColumnType());
            case "PdateDaysBefore":
                Integer pDateValueDateBefore = Integer.valueOf(conditionDto.getOperationValue());
                return getCompare1Sql(String.format("datediff(%s,%s)", "from_unixtime(unix_timestamp(p_date, 'yyyyMMdd'))", conditionDto.getColumnName()), ">=", pDateValueDateBefore + "",
                        7);
            case "DaysAfter":
                Integer valueDateAfter = Integer.valueOf(conditionDto.getOperationValue());
                String compareDateAfter = String.format("${+%s day#yyyy-MM-dd}", valueDateAfter + "");
                return getCompare1Sql(conditionDto.getColumnName(), ">", compareDateAfter,
                        conditionDto.getColumnType());
            case "PdateDaysIn":
                Integer pDateValueDateIn = Integer.valueOf(conditionDto.getOperationValue());
                return getCompare1Sql(String.format("datediff(%s,%s)", "from_unixtime(unix_timestamp(p_date, 'yyyyMMdd'))", conditionDto.getColumnName()), "between", "0 and " + pDateValueDateIn + "",
                        7);
            case "Rlike":
                return getCompare1Sql(conditionDto.getColumnName(), "rlike",
                        conditionDto.getOperationValue(), conditionDto.getColumnType());
            case "NotRlike":
                return getCompare1Sql(conditionDto.getColumnName(), "not rlike",
                        conditionDto.getOperationValue(), conditionDto.getColumnType());
        }
        return null;
    }

    public String getCompare1Sql(String column, String operation, String value, int type) {
        if (("=".equals(operation) || "<>".equals(operation)) && value.contains(",")) {
            switch (type) {
                case 0:
                case 1:
                case 7:
                    if ("=".equals(operation)) {
                        return getNumberIn(column, value);
                    } else {
                        return getNumberNotIn(column, value);
                    }
                case 2:
                case 5:
                    if ("=".equals(operation)) {
                        return getStringIn(column, value);
                    } else {
                        return getStringNotIn(column, value);
                    }
                case 3: // array
                    if ("=".equals(operation)) {
                        return "json_array_contains_any(" + column + ",'" + value + "')";
                    } else {
                        return "json_array_contains_any(" + column + ",'" + value + "') = false";
                    }
                case 4: // map
                    if ("=".equals(operation)) {
                        return "json_map_contains_any(" + column + ",'" + value + "')";
                    } else {
                        return "json_map_contains_any(" + column + ",'" + value + "') = false";
                    }
            }
        } else if (column == null || StringUtils.isEmpty(column)) {
            switch (type) {
                case 0:
                case 1:
                case 6:
                    return column + " " + operation + " " + value;
                case 2:
                case 5:
                    return column + " " + operation + " '" + value + "'";
            }
        } else {
            switch (type) {
                case 1:
                case 0:
                    return "cast(" + column + " as float) " + operation + " " + value;
                case 6:
                    if (column.contains("ifly_map_get")) {
                        return column + operation + " '" + value + "'";
                    } else {
                        return "if(" + column + ",'true','false') " + operation + " '" + value + "'";
                    }
                case 3:
                    if ("=".equals(operation)) {
                        return "json_array_contains_any(" + column + ",'" + value + "')";
                    } else {
                        return "json_array_contains_any(" + column + ",'" + value + "') = false";
                    }
                case 4: // map
                    if ("=".equals(operation)) {
                        return "json_map_contains_any(" + column + ",'" + value + "')";
                    } else {
                        return "json_map_contains_any(" + column + ",'" + value + "') = false";
                    }
                case 2:
                    return column + " " + operation + " '" + value + "'";
                case 5:
                    return column + " " + operation + " '" + value + "'";
                case 7:
                    return column + " " + operation + " " + value + "";
            }
        }
        return null;
    }

    public String getCompare2Sql(String column, String value1, String value2, int type) {
        switch (type) {
            case 0:
            case 1:
                return "cast(" + column + " as float) " + " between " + value1 + " and " + value2;
            case 5:
                return column + " between '" + value1 + "' and '" + value2 + "'";
        }
        return null;
    }

    private String getNullSql(String column, int type) {
        switch (type) {
            case 0:
            case 1:
            case 2:
            case 5:
            case 6:
                return column + " is null";
            case 3:
            case 4:
                return column + " is null or " + column + "='[]'";
        }
        return null;
    }

    private String getNotNullSql(String column, int type) {
        switch (type) {
            case 0:
            case 1:
            case 2:
            case 5:
            case 6:
                return column + " is not null";
            case 3:
            case 4:
                return column + " is not null and " + column + "!='[]'";
        }
        return null;
    }

    private String getStringIn(String columnName, String compareStringValue) {
        List<String> list = new ArrayList<>();
        String[] propertyValues = compareStringValue.split(",");
        for (String propertyValue : propertyValues) {
            list.add("'" + propertyValue.trim() + "'");
        }
        return columnName + " in (" + Joiner.on(",").join(list) + ")";
    }

    private String getStringNotIn(String columnName, String compareStringValue) {
        List<String> list = new ArrayList<>();
        String[] propertyValues = compareStringValue.split(",");
        for (String propertyValue : propertyValues) {
            list.add("'" + propertyValue.trim() + "'");
        }
        return columnName + " not in (" + Joiner.on(",").join(list) + ")";
    }

    private String getNumberIn(String columnName, String compareValue) {
        String[] propertyValues = compareValue.split(",");
        return "cast(" + columnName + " as int)" + " in (" + Joiner.on(",").join(propertyValues) + ")";
    }

    private String getNumberNotIn(String columnName, String compareValue) {
        String[] propertyValues = compareValue.split(",");
        return columnName + " not in (" + Joiner.on(",").join(propertyValues) + ")";
    }

    private String getContainAnySql(String columnName, String operationValue, Integer columnType) {
        switch (columnType) {
            case 0:
            case 1:
                return getNumberIn(columnName, operationValue);
            case 2:
                return getStringIn(columnName, operationValue);
            case 3: // array
                return "json_array_contains_any(" + columnName + ",'" + operationValue + "')";
            case 4: // map
                return "json_map_contains_any(" + columnName + ",'" + operationValue + "')";
            case 5: // array
                return "array_contains(" + columnName + ",'" + operationValue + "')";
        }
        return null;
    }

    private String getNotContainAnySql(String columnName, String operationValue, Integer columnType) {
        switch (columnType) {
            case 0:
            case 1:
                return getNumberNotIn(columnName, operationValue);
            case 2:
                return getStringIn(columnName, operationValue);
            case 3: // array
                return "json_array_contains_any(" + columnName + ",'" + operationValue + "') = false";
            case 4: // map
                return "json_map_contains_any(" + columnName + ",'" + operationValue + "') = false";
            case 5: // array
                return "array_contains(" + columnName + ",'" + operationValue + "') = false ";
        }
        return null;
    }

    private String getContainAllSql(String columnName, String operationValue, Integer columnType) {
        switch (columnType) {
            case 0:
            case 1:
                return getNumberIn(columnName, operationValue);
            case 2:
                return getStringIn(columnName, operationValue);
            case 3: // array
                return "json_array_contains_all(" + columnName + ",'" + operationValue + "')";
            case 4: // map
                return "json_map_contains_all(" + columnName + ",'" + operationValue + "')";
            case 5: // todo 开发一个数组全部包含的 udf 函数
                return "array_contains(" + columnName + ",'" + operationValue + "')";
        }
        return null;
    }

    public List<Operation> profileOperationList(Integer type) {
        if (type == null) {
            return null;
        }
        return columnOperationList(type);
    }

    public List<PropertyDto> getCommonPropertyList() {
        List<PropertyDto> list = new ArrayList<>();
        MetadataEventProperty commonSearch = new MetadataEventProperty();
        commonSearch.setEventName("all");
        List<MetadataEventProperty> commonList = iMetadataEventPropertyService.select(commonSearch);
        for (MetadataEventProperty eventProperty : commonList) {
            PropertyDto propertyDto = new PropertyDto();
            propertyDto.setName(eventProperty.getName());
            propertyDto.setType(eventProperty.getType());
            list.add(propertyDto);
        }
        return list;
    }

    public void incEventSort(String eventName) {
        iMetadataEventService.incSort(eventName);
    }

    public void incEventPropertySort(String eventName, String propertyName) {
        iMetadataEventPropertyService.incEventPropertySort(eventName, propertyName);
    }

    public String getViewTable(Date startT, Date endT, String dateQuery, String select) {
        return getViewTableWithoutAlias(startT, endT, dateQuery, select) + " events";
    }

    public String getViewTableWithoutAlias(Date startT, Date endT, String dateQuery, String select) {
        Set<String> weeks = new HashSet<>();
        List<String> days = DateUtil.getDatesOfDayBetweenDates(startT, endT, DateStyle.YYYY_MM_DD);
        for (String day : days) {
            if (DateUtil.getWeek(DateUtil.StringToDate(day)).getNumber() == 1) {
                weeks.add(day);
            }
        }
        Integer week = DateUtil.getWeek(startT).getNumber();
        if (week > 1) {
            weeks.add(DateUtil.DateToString(DateUtil.addDay(startT, -(week - 1)), DateStyle.YYYY_MM_DD));
        } else if (week == 0) {
            weeks.add(DateUtil.DateToString(DateUtil.addDay(startT, -6), DateStyle.YYYY_MM_DD));
        }
        List<String> wlist = new ArrayList<>(weeks);
        List<String> tables = new ArrayList<>();
        for (String s : wlist) {
            Date mon = DateUtil.StringToDate(s, DateStyle.YYYY_MM_DD);
            if (mon.after(new Date())) {
                continue;
            }
            String weekTable = "w_events_" + DateUtil.StringToString(s, DateStyle.YYYY_MM_DD, DateStyle.YYYYMMDD);
            if (!blackSet.contains(weekTable)) {
                tables.add(weekTable);
            }
        }
        tables.add("d_events");
        Collections.sort(tables);
        List<String> sqlList = new ArrayList<>();
        for (String mon : tables) {
            String sql = "select " + select + " from iflytek_ods_event." + mon + " where 1=1 " + dateQuery;
            sqlList.add(sql);
        }
        return "( " + Joiner.on(" UNION ALL ").join(sqlList) + ")";
    }

    public String getViewTableWithoutAliaslEventName(Date startT, Date endT, String dateQuery, String select, String eventFilter) {
        Set<String> weeks = new HashSet<>();
        List<String> days = DateUtil.getDatesOfDayBetweenDates(startT, endT, DateStyle.YYYY_MM_DD);
        for (String day : days) {
            if (DateUtil.getWeek(DateUtil.StringToDate(day)).getNumber() == 1) {
                weeks.add(day);
            }
        }
        Integer week = DateUtil.getWeek(startT).getNumber();
        if (week > 1) {
            weeks.add(DateUtil.DateToString(DateUtil.addDay(startT, -(week - 1)), DateStyle.YYYY_MM_DD));
        } else if (week == 0) {
            weeks.add(DateUtil.DateToString(DateUtil.addDay(startT, -6), DateStyle.YYYY_MM_DD));
        }
        List<String> wlist = new ArrayList<>(weeks);
        List<String> tables = new ArrayList<>();
        for (String s : wlist) {
            Date mon = DateUtil.StringToDate(s, DateStyle.YYYY_MM_DD);
            if (mon.after(new Date())) {
                continue;
            }
            String weekTable = "w_events_" + DateUtil.StringToString(s, DateStyle.YYYY_MM_DD, DateStyle.YYYYMMDD);
            if (!blackSet.contains(weekTable)) {
                tables.add(weekTable);
            }
        }
        tables.add("d_events");
        Collections.sort(tables);
        List<String> sqlList = new ArrayList<>();
        for (String mon : tables) {
            String sql = "select " + select + " from iflytek_ods_event." + mon + " where 1=1 " + dateQuery + eventFilter;
            sqlList.add(sql);
        }
        return "( " + Joiner.on(" UNION ALL ").join(sqlList) + ")";
    }

    public Response globalProperties(String types,
                                     Set<String> eventsSet,
                                     String returnType) {
        List<MetadataEventProperty> allList = new ArrayList<>();
        if (StringUtils.isNotEmpty(types)) {
            Boolean multi = false;
            Set<String> typeSet = new HashSet<>(Arrays.asList(types.split(",")));
            if (typeSet.size() > 1 && "list".equals(returnType)) {
                multi = true;
            }
            if (typeSet.contains("P")) {
                if (CollectionUtils.isNotEmpty(eventsSet)) {
                    Set<String> eventSet = new HashSet<>();
                    for (String events : eventsSet) {
                        if (StringUtils.isNotEmpty(events)) {
                            if (events.startsWith("V|")) {
                                String event = events.substring(2);
                                VirtualEventWithBLOBs virtualEventWithBLOBs = iVirtualEventService.selectByName(event);
                                if (virtualEventWithBLOBs != null) {
                                    List<EventDto> eventDtos = JSONArray.parseArray(virtualEventWithBLOBs.getEventFilter(), EventDto.class);
                                    for (EventDto eventDto : eventDtos) {
                                        eventSet.add(eventDto.getEvent());
                                    }
                                }
                            }
                        }
                    }
                    if (CollectionUtils.isNotEmpty(eventSet)) {
                        eventsSet.addAll(eventSet);
                    }
                    String eventString = Joiner.on(",").join(eventsSet);
                    String[] eventArray = eventString.split(",");
                    if (eventArray.length == 1) {
                        MetadataEventProperty searchItem = new MetadataEventProperty();
                        searchItem.setEventName(eventArray[0]);
                        List<MetadataEventProperty> properties = iMetadataEventPropertyService.select(searchItem);
                        if (CollectionUtils.isNotEmpty(properties)) {
                            for (MetadataEventProperty property : properties) {
                                if (multi) property.setShowName("私有属性|" + property.getShowName());
                                property.setCategory("P");
                                allList.add(property);
                            }
                        }
                    } else {
//                        List<MetadataEventProperty> properties = iMetadataEventPropertyService.selectCommonProperty(eventArray, eventArray.length);
                        // new HashSet<>(Arrays.asList(s)) 修复公共属性并集
                        List<MetadataEventProperty> properties = iMetadataEventPropertyService.selectUnionProperty(eventArray, new HashSet<>(Arrays.asList(eventArray)).size());
                        if (CollectionUtils.isNotEmpty(properties)) {
                            for (MetadataEventProperty property : properties) {
                                property.setCategory("P");
                                allList.add(property);
                            }
                        }
                    }
                }
            }
            if (typeSet.contains("U")) {
                MetadataProfileColumn search = new MetadataProfileColumn();
                search.setDisplay(1);
                List<MetadataProfileColumn> list = iMetadataProfileColumnService.select(search);
                for (MetadataProfileColumn metadataProfileColumn : list) {
                    MetadataEventProperty eventProperty = new MetadataEventProperty();
                    eventProperty.setEventName("all");
                    eventProperty.setName("U|" + metadataProfileColumn.getName());
                    if (multi) {
                        eventProperty.setShowName("用户属性|" + metadataProfileColumn.getShowName());
                    } else {
                        eventProperty.setShowName(metadataProfileColumn.getShowName());
                    }
                    eventProperty.setType(typeMap2.get(Integer.valueOf(metadataProfileColumn.getType())));
                    eventProperty.setCategory("U");
                    allList.add(eventProperty);
                }
            }
            if (typeSet.contains("G")) {
                MetadataEventProperty groupSearch = new MetadataEventProperty();
                groupSearch.setDisplay(1);
                groupSearch.setEventName("all");
                List<MetadataEventProperty> groupList = iMetadataEventPropertyService.select(groupSearch);
                for (MetadataEventProperty eventProperty : groupList) {
                    if (multi) eventProperty.setShowName("用户分群|" + eventProperty.getShowName());
                    if (eventProperty.getName().startsWith("G|")) {
                        eventProperty.setCategory("G");
                        allList.add(eventProperty);
                    }
                }
            }
            if (typeSet.contains("C")) {
                MetadataEventProperty commonSearch = new MetadataEventProperty();
                commonSearch.setDisplay(1);
                commonSearch.setEventName("all");
                List<MetadataEventProperty> commonList = iMetadataEventPropertyService.select(commonSearch);
                Set<String> commonPros = getCommonPros();
                for (MetadataEventProperty eventProperty : commonList) {
                    if (commonPros.contains(eventProperty.getName())) {
                        eventProperty.setName("C|" + eventProperty.getName());
                        if (multi) eventProperty.setShowName("通用属性|" + eventProperty.getShowName());
                        eventProperty.setCategory("C");
                        allList.add(eventProperty);
                    }
                }
            }
            if (typeSet.contains("E")) {
                MetadataEventProperty commonSearch = new MetadataEventProperty();
                commonSearch.setDisplay(1);
                commonSearch.setEventName("all");
                List<MetadataEventProperty> artemisLabels = iMetadataEventPropertyService.select(commonSearch);
                for (MetadataEventProperty eventProperty : artemisLabels) {
                    if (eventProperty.getName().startsWith("E")) {
                        if (multi) eventProperty.setShowName("实验标签|" + eventProperty.getShowName());
                        eventProperty.setCategory("E");
                        allList.add(eventProperty);
                    }
                }
            }
            if (typeSet.contains("D")) {
                if (CollectionUtils.isNotEmpty(eventsSet)) {
                    Set<String> eventSet = new HashSet<>();
                    for (String events : eventsSet) {
                        if (events.startsWith("V|")) {
                            String event = events.substring(2);
                            VirtualEventWithBLOBs virtualEventWithBLOBs = iVirtualEventService.selectByName(event);
                            if (virtualEventWithBLOBs != null) {
                                List<EventDto> eventDtos = JSONArray.parseArray(virtualEventWithBLOBs.getEventFilter(), EventDto.class);
                                for (EventDto eventDto : eventDtos) {
                                    eventSet.add(eventDto.getEvent());
                                }
                            }
                        }
                    }
                    String eventString = Joiner.on(",").join(eventSet);
                    String[] eventArray = eventString.split(",");
                    for (String event : eventArray) {
                        if (StringUtils.isNotEmpty(event)) {
                            List<DimColumn> columns = iDimService.selectDimColumns(event);
                            for (DimColumn column : columns) {
                                MetadataEventProperty eventProperty = new MetadataEventProperty();
                                eventProperty.setEventName(event);
                                eventProperty.setName("D|" + column.getId());
                                if (multi) {
                                    eventProperty.setShowName("维度表|" + column.getShowName());
                                } else {
                                    eventProperty.setShowName(column.getShowName());
                                }
                                eventProperty.setType(column.getType());
                                eventProperty.setCategory("D");
                                allList.add(eventProperty);
                            }
                        }
                    }
                }
            }
        }
        if ("map".equals(returnType)) {
            Map<String, List<MetadataEventProperty>> map = new LinkedHashMap<>();
            for (MetadataEventProperty metadataEventProperty : allList) {
                if (!map.containsKey(metadataEventProperty.getCategory())) {
                    map.put(metadataEventProperty.getCategory(), new ArrayList<MetadataEventProperty>());
                }
                List<MetadataEventProperty> list = map.get(metadataEventProperty.getCategory());
                list.add(metadataEventProperty);
            }
            return new Response(map);
        } else {
            return new Response(allList);
        }
    }

    public Response propertyValue(String event, String property) {
        if (StringUtils.isNotEmpty(event)) {
            if (event.startsWith("V|")) {
                event = event.substring(2);
            }
            VirtualEventWithBLOBs virtualEventWithBLOBs = iVirtualEventService.selectByName(event);
            if (virtualEventWithBLOBs != null) {
                List<EventDto> eventDtos = JSONArray.parseArray(virtualEventWithBLOBs.getEventFilter(), EventDto.class);
                event = eventDtos.get(0).getEvent();
            }
        }
        List<EnumValueDto> valueList = new ArrayList<>();
        if (property.startsWith("C|")) {
            if (property.startsWith("C|")) {
                property = property.substring(2);
            }
            MetadataEventPropertyValue metadataEventPropertyValue = new MetadataEventPropertyValue();
            metadataEventPropertyValue.setEvent("all");
            metadataEventPropertyValue.setProperty(property);
            List<MetadataEventPropertyValue> list = iMetadataEventPropertyValueService.select(metadataEventPropertyValue);
            if (CollectionUtils.isNotEmpty(list)) {
                metadataEventPropertyValue = list.get(0);
                if (StringUtils.isNotEmpty(metadataEventPropertyValue.getValue())) {
                    for (String val : metadataEventPropertyValue.getValue().split(",")) {
                        valueList.add(new EnumValueDto(val, val));
                    }
                }
            }
        } else if (property.startsWith("U|")) {
            property = property.substring(2);
            MetadataProfileColumn search = new MetadataProfileColumn();
            search.setName(property);
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
                        valueList.add(new EnumValueDto(enumVArr[0], enumVArr[1]));
                    }
                }
            }
        } else if (property.startsWith("E")) {
            if (property.startsWith("E")) {
                property = property.substring(1);
            }
            try {
                String result = OkHttpUtil.get(expGroupsUrl + "?expId=" + property, null);
                JSONObject json = JSONObject.parseObject(result);
                if (json.getInteger("code") == 0) {
                    JSONArray array = json.getJSONArray("data");
                    if (CollectionUtils.isNotEmpty(array)) {
                        for (int i = 0; i < array.size(); i++) {
                            String groupId = array.getJSONObject(i).getString("groupId");
                            valueList.add(new EnumValueDto(groupId, groupId));
                        }
                    }
                }
            } catch (Exception e) {
                log.error("请求AB失败:{}", e.getMessage());
            }
        } else if (property.startsWith("G|")) {
            // group 不做逻辑
        } else {
            MetadataEventPropertyValue metadataEventPropertyValue = new MetadataEventPropertyValue();
            metadataEventPropertyValue.setEvent(event);
            metadataEventPropertyValue.setProperty(property);
            List<MetadataEventPropertyValue> list = iMetadataEventPropertyValueService.select(metadataEventPropertyValue);
            if (CollectionUtils.isNotEmpty(list)) {
                metadataEventPropertyValue = list.get(0);
                if (StringUtils.isNotEmpty(metadataEventPropertyValue.getValue())) {
                    for (String val : metadataEventPropertyValue.getValue().split(",")) {
                        valueList.add(new EnumValueDto(val, val));
                    }
                }
            }
        }
        return new Response(valueList);
    }

    public Response metadataInfo(String operator, String names, Integer type) {
        List<RequestPair> requestPairs = new ArrayList<>();
        String data = names;
        if (names.contains("|")) {
            data = names.substring(2);
        }
        String result = "";
        try {
            switch (type) {
                case 0: // 埋点属性
                    requestPairs.add(new RequestPair("name", data));
                    requestPairs.add(new RequestPair("app", "iflytek"));
                    result = OkHttpUtil.get(marmotHost + "/internal/marmot/v1/event/name", requestPairs);
                    break;
                case 1: // 通用属性
                    requestPairs.add(new RequestPair("app", "iflytek"));
                    result = OkHttpUtil.get(marmotHost + "/internal/marmot/v1/property/public", requestPairs);
                    JSONObject json = JSONObject.parseObject(result);
                    JSONArray jsonArray = JSONArray.parseArray(json.getString("data"));
                    String finalData = CaseFormat.LOWER_UNDERSCORE.to(CaseFormat.LOWER_CAMEL, data);
                    JSONArray jsonArray1 = jsonArray.stream().filter(iter -> ((JSONObject) iter).getString("name").equals(finalData)).distinct().collect(Collectors.toCollection(JSONArray::new));
                    return new Response(jsonArray1.getJSONObject(0));
                case 2: // 私有属性（业务自定义属性）
                    requestPairs.add(new RequestPair("name", data));
                    requestPairs.add(new RequestPair("app", "iflytek"));
                    result = OkHttpUtil.get(marmotHost + "/internal/marmot/v1/properties/detail", requestPairs);
                    break;
                case 3: // 实验标签 artemisHost
                    requestPairs.add(new RequestPair("expId", Integer.valueOf(data)));
                    result = OkHttpUtil.get(artemisHost + "/iflytek/artemis/v1/experimentByExpId", requestPairs);
                    break;
                case 4: // 属性信息 从详情列表拿取，标签的覆盖人数，以及覆盖率
                    requestPairs.add(new RequestPair("name", data));
                    result = OkHttpUtil.get(portraitHost + "/iflytek/portrait/v1/columninfo/name", requestPairs, "ldapUsername", operator);
                    break;
                case 5: // 分群
                    requestPairs.add(new RequestPair("id", Integer.valueOf(data)));
                    result = OkHttpUtil.get(portraitHost + "/iflytek/portrait/v2/groupinfo/" + data, requestPairs, "ldapUsername", operator);
                    break;
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        JSONObject json = JSONObject.parseObject(result);
        if (StringUtils.isNotEmpty(json.getString("data"))) {
            JSONObject jsonData = JSONObject.parseObject(json.getString("data"));
            return new Response(jsonData);
        }
        return new Response(500, result);
    }
}
