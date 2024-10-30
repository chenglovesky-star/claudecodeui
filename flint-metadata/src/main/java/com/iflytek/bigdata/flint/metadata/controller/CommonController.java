package com.iflytek.bigdata.flint.metadata.controller;

import com.alibaba.fastjson.JSONArray;
import com.google.common.base.Joiner;
import com.iflytek.bigdata.flint.common.dto.Response;
import com.iflytek.bigdata.flint.metadata.dao.model.*;
import com.iflytek.bigdata.flint.metadata.dto.EnumValueDto;
import com.iflytek.bigdata.flint.metadata.dto.EventDto;
import com.iflytek.bigdata.flint.metadata.dto.ProfileColumnDto;
import com.iflytek.bigdata.flint.metadata.dto.ViewByDto;
import com.iflytek.bigdata.flint.metadata.service.*;
import com.iflytek.bigdata.flint.metadata.utils.MetadataUtil;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import lombok.extern.log4j.Log4j2;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

import javax.annotation.PostConstruct;
import javax.annotation.Resource;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Log4j2
@RestController
@CrossOrigin(origins = "*")
@Api(value = "常用接口")
@RequestMapping("/iflytek/flint/metadata/common")
public class CommonController {

    private static final int GROUP_CAT_ID = 1000;

    @Resource
    private MetadataUtil metadataUtil;

    @Resource
    private IMetadataEventService iMetadataEventService;

    @Resource
    private IMetadataEventPropertyService iMetadataEventPropertyService;

    @Resource
    private IMetadataProfileCategoryService iMetadataProfileCategoryService;

    @Resource
    private IMetadataProfileColumnService iMetadataProfileColumnService;

    @Resource
    private IMetadataEventPropertyValueService iMetadataEventPropertyValueService;

    @Resource
    private IVirtualEventService iVirtualEventService;

    private Map<String, List<EnumValueDto>> enumMap = new ConcurrentHashMap<>();

    private Map<String, Integer> typeMap = new ConcurrentHashMap<>();

    private Map<Integer, String> typeMap2 = new ConcurrentHashMap<>();

    @Resource
    private IDimService iDimService;

    @PostConstruct
    public void init() {
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
        typeMap2.put(0, "int");
        typeMap2.put(1, "double");
        typeMap2.put(2, "string");
        typeMap2.put(3, "list");
        typeMap2.put(4, "map");
        typeMap2.put(5, "datetime");
        typeMap2.put(6, "boolean");
        Timer timer = new Timer(true);
        timer.schedule(new TimerTask() {

            @Override
            public void run() {
                try {
                    enumMap = new ConcurrentHashMap<>();
                    MetadataProfileColumnExample example = new MetadataProfileColumnExample();
                    List<MetadataProfileColumn> searchList = iMetadataProfileColumnService.selectByExample(example);
                    for (MetadataProfileColumn metadataProfileColumn : searchList) {
                        List<EnumValueDto> enumValueDtos = new ArrayList<>();
                        String enumValues = metadataProfileColumn.getEnumValues();
                        String[] enumValuesArr = enumValues.split(",");
                        for (int i = 0; i < enumValuesArr.length; i++) {
                            String enumV = enumValuesArr[i];
                            String[] enumVArr = enumV.split("=");
                            if (enumVArr.length < 2) {
                                continue;
                            }
                            EnumValueDto enumValueDto = new EnumValueDto(enumVArr[0], enumVArr[1]);
                            enumValueDtos.add(enumValueDto);
                        }
                        enumMap.put(metadataProfileColumn.getName(), enumValueDtos);
                    }
                } catch (Exception e) {
                    log.error(e.getMessage());
                }
            }
        }, 0, 1000L);

    }

    @ApiOperation(value = "埋点列表", notes = "埋点列表")
    @GetMapping("/event")
    @ResponseBody
    public Response<MetadataEvent> event(String keyword, @RequestHeader(value = "ldapUsername", required = false) String operator) {
        MetadataEvent search = new MetadataEvent();
        search.setShowName(keyword);
        search.setDisplay(1);
        List<MetadataEvent> list = iMetadataEventService.select(search);
        VirtualEventWithBLOBs search2 = new VirtualEventWithBLOBs();
        search2.setDisplay(1);
        search2.setDisplayName(keyword);
        List<VirtualEventWithBLOBs> virtualEvents = iVirtualEventService.select(search2);
        for (VirtualEventWithBLOBs virtualEvent : virtualEvents) {
            if (virtualEvent.getDisplay() == 0) continue;
            MetadataEvent v = new MetadataEvent();
            v.setName("V|" + virtualEvent.getName());
            v.setShowName("虚拟事件|" + virtualEvent.getDisplayName());
            v.setDisplay(virtualEvent.getDisplay());
            v.setDescription(virtualEvent.getDescription());
            v.setSort(0);
            list.add(v);
        }
        if (StringUtils.isNotEmpty(keyword)) {
            final String kw = keyword;
            Collections.sort(list, new Comparator<MetadataEvent>() {

                @Override
                public int compare(MetadataEvent o1, MetadataEvent o2) {
                    return o1.getShowName().indexOf(kw) - o2.getShowName().indexOf(kw);
                }
            });
        } else {
            Collections.sort(list, new Comparator<MetadataEvent>() {

                @Override
                public int compare(MetadataEvent o1, MetadataEvent o2) {
                    int result = o2.getSort().compareTo(o1.getSort());
                    if (result == 0) {
                        return o1.getShowName().compareTo(o2.getShowName());
                    } else {
                        return result;
                    }
                }
            });
        }

        return new Response(list);
    }

    @ApiOperation(value = "纯埋点列表", notes = "纯埋点列表")
    @GetMapping("/eventWithoutVirtual")
    @ResponseBody
    public Response<MetadataEvent> eventWithoutVirtual(String keyword, @RequestHeader(value = "ldapUsername", required = false) String operator) {
        MetadataEvent search = new MetadataEvent();
        search.setShowName(keyword);
        search.setDisplay(1);
        List<MetadataEvent> list = iMetadataEventService.select(search);
        if (StringUtils.isNotEmpty(keyword)) {
            final String kw = keyword;
            Collections.sort(list, new Comparator<MetadataEvent>() {

                @Override
                public int compare(MetadataEvent o1, MetadataEvent o2) {
                    return o1.getShowName().indexOf(kw) - o2.getShowName().indexOf(kw);
                }
            });
        } else {
            Collections.sort(list, new Comparator<MetadataEvent>() {

                @Override
                public int compare(MetadataEvent o1, MetadataEvent o2) {
                    int result = o2.getSort().compareTo(o1.getSort());
                    if (result == 0) {
                        return o1.getShowName().compareTo(o2.getShowName());
                    } else {
                        return result;
                    }
                }
            });
        }
        return new Response(list);
    }

    @ApiOperation(value = "埋点属性列表", notes = "埋点属性列表")
    @GetMapping("/event/property")
    @ResponseBody
    public Response property(String event, @RequestHeader(value = "ldapUsername", required = false) String operator) {
        MetadataEventProperty commonSearch = new MetadataEventProperty();
        commonSearch.setEventName("all");
        commonSearch.setDisplay(1);
        List<MetadataEventProperty> commonList = iMetadataEventPropertyService.select(commonSearch);
        Set<String> commonPros = metadataUtil.getCommonPros();
        for (MetadataEventProperty eventProperty : commonList) {
            if (eventProperty.getName().startsWith("E")) {
                eventProperty.setShowName("实验标签|" + eventProperty.getShowName());
                eventProperty.setSort(-1);
            }
            if (commonPros.contains(eventProperty.getName())) {
                eventProperty.setName("C|" + eventProperty.getName());
                eventProperty.setShowName("通用属性|" + eventProperty.getShowName());
            }
        }
//        if (event.startsWith("V|")) {
//            return new Response(commonList);
//        }
        MetadataEventProperty search = new MetadataEventProperty();
        search.setEventName(event);
        search.setDisplay(1);
        List<MetadataEventProperty> allList = new ArrayList<>();
        List<MetadataEventProperty> privateList = iMetadataEventPropertyService.select(search);
        if (CollectionUtils.isNotEmpty(privateList)) {
            for (MetadataEventProperty property : privateList) {
                property.setShowName("私有属性|" + property.getShowName());
                allList.add(property);
            }
        }
        allList.addAll(commonList);
        MetadataProfileColumn profile = new MetadataProfileColumn();
        List<MetadataProfileColumn> profileList = iMetadataProfileColumnService.select(profile);
        for (MetadataProfileColumn metadataProfileColumn : profileList) {
            MetadataEventProperty eventProperty = new MetadataEventProperty();
            eventProperty.setId(metadataProfileColumn.getId());
            eventProperty.setEventName("all");
            eventProperty.setName("U|" + metadataProfileColumn.getName());
            eventProperty.setShowName("用户属性|" + metadataProfileColumn.getShowName());
            eventProperty.setType(typeMap2.get(Integer.valueOf(metadataProfileColumn.getType())));
            allList.add(eventProperty);
        }
        return new Response(allList);
    }

    @ApiOperation(value = "埋点属性比较符列表", notes = "埋点属性比较符列表")
    @GetMapping("/event/property/operation")
    @ResponseBody
    public Response operation(String type) {
        List<Operation> operations = metadataUtil.propertyOperationList(type);
        return new Response(operations);
    }

    @ApiOperation(value = "画像分类列表", notes = "画像分类列表")
    @GetMapping("/profile/category")
    @ResponseBody
    public Response profileCategory() {
        List<MetadataProfileCategory> list = iMetadataProfileCategoryService.select(null);
        MetadataProfileCategory groupCategory = new MetadataProfileCategory();
        groupCategory.setDisplay(1);
        groupCategory.setId(GROUP_CAT_ID);
        groupCategory.setName("用户分群");
        groupCategory.setShowName("用户分群");
        list.add(groupCategory);
        return new Response(list);
    }

    @ApiOperation(value = "画像属性列表", notes = "画像属性列表")
    @GetMapping("/profile/column")
    @ResponseBody
    public Response profileColumn(@RequestParam(required = false) Integer categoryId, @RequestHeader(value = "ldapUsername", required = false) String operator) {
        if (categoryId != null && categoryId == GROUP_CAT_ID) {
            List<MetadataProfileColumn> list = new ArrayList<>();
            MetadataEventProperty commonSearch = new MetadataEventProperty();
            commonSearch.setEventName("all");
            List<MetadataEventProperty> allList = iMetadataEventPropertyService.select(commonSearch);
            String enumValues = "true=是,false=否";
            List<EnumValueDto> enumValuesList = new ArrayList<>();
            enumValuesList.add(new EnumValueDto("true", "是"));
            enumValuesList.add(new EnumValueDto("false", "否"));
            for (MetadataEventProperty eventProperty : allList) {
                if (eventProperty.getName().startsWith("G|")) {
                    MetadataProfileColumn groupColumn = new MetadataProfileColumn();
                    groupColumn.setCategoryId(GROUP_CAT_ID);
                    groupColumn.setDisplay(1);
                    groupColumn.setId(-eventProperty.getId());
                    groupColumn.setName(eventProperty.getName());
                    groupColumn.setShowName(eventProperty.getShowName());
                    groupColumn.setType("" + typeMap.get(eventProperty.getType()));
                    groupColumn.setEnumValues(enumValues);
                    groupColumn.setEnumValuesList(enumValuesList);
                    list.add(groupColumn);
                }
            }
            return new Response(list);
        } else {
            MetadataProfileColumn search = new MetadataProfileColumn();
            if (categoryId != null) {
                search.setCategoryId(categoryId);
            }
            List<MetadataProfileColumn> list = iMetadataProfileColumnService.select(search);
            for (MetadataProfileColumn metadataProfileColumn : list) {
                if (enumMap.containsKey(metadataProfileColumn.getName())) {
                    metadataProfileColumn.setEnumValuesList(enumMap.get(metadataProfileColumn.getName()));
                } else {
                    if (StringUtils.isNotEmpty(metadataProfileColumn.getEnumValues())) {
                        List<EnumValueDto> enumValuesList = new ArrayList<>();
                        String[] arr = metadataProfileColumn.getEnumValues().split(",");
                        for (String en : arr) {
                            String[] ens = en.split("=");
                            if (ens.length == 2) {
                                enumValuesList.add(new EnumValueDto(ens[0].trim(), ens[1].trim()));
                            }
                        }
                        metadataProfileColumn.setEnumValuesList(enumValuesList);
                    }
                }
            }
            List<MetadataProfileColumn> list2 = new ArrayList<>();
            MetadataEventProperty commonSearch = new MetadataEventProperty();
            commonSearch.setEventName("all");
            List<MetadataEventProperty> allList = iMetadataEventPropertyService.select(commonSearch);
            String enumValues = "true=是,false=否";
            List<EnumValueDto> enumValuesList = new ArrayList<>();
            enumValuesList.add(new EnumValueDto("true", "是"));
            enumValuesList.add(new EnumValueDto("false", "否"));
            for (MetadataEventProperty eventProperty : allList) {
                if (eventProperty.getName().startsWith("G|")) {
                    MetadataProfileColumn groupColumn = new MetadataProfileColumn();
                    groupColumn.setCategoryId(GROUP_CAT_ID);
                    groupColumn.setDisplay(1);
                    groupColumn.setId(-eventProperty.getId());
                    groupColumn.setName(eventProperty.getName());
                    groupColumn.setShowName(eventProperty.getShowName());
                    groupColumn.setType("" + typeMap.get(eventProperty.getType()));
                    groupColumn.setEnumValues(enumValues);
                    groupColumn.setEnumValuesList(enumValuesList);
                    list.add(groupColumn);
                }
            }
            return new Response(list);
        }
    }

    @ApiOperation(value = "画像属性列表", notes = "画像属性列表")
    @GetMapping("/profile/fieldBys")
    @ResponseBody
    public Response profileFieldBys(@RequestHeader(value = "ldapUsername", required = false) String operator) {
        MetadataProfileColumnExample example = new MetadataProfileColumnExample();
        MetadataProfileColumnExample.Criteria criteria = example.createCriteria();
        criteria.andCategoryIdNotEqualTo(999);
        List<String> types = new ArrayList<>();
        //types.add("3"); 开放array类型
        types.add("4");
        criteria.andTypeNotIn(types);
        List<MetadataProfileColumn> list = iMetadataProfileColumnService.selectByExample(example);
        List<ProfileColumnDto> profileColumnDtoList = new ArrayList<ProfileColumnDto>();
//        for (MetadataProfileColumn metadataProfileColumn : list) {
//            metadataProfileColumn.setShowName("用户属性|" + metadataProfileColumn.getShowName());
//        }
        profileColumnDtoList.add(new ProfileColumnDto("用户属性", list));
        MetadataEventProperty commonSearch = new MetadataEventProperty();
        commonSearch.setEventName("all");
        commonSearch.setDisplay(1);
        List<MetadataEventProperty> allList = iMetadataEventPropertyService.select(commonSearch);
        String enumValues = "true=是,false=否";
        List<EnumValueDto> enumValuesList = new ArrayList<>();
        enumValuesList.add(new EnumValueDto("true", "是"));
        enumValuesList.add(new EnumValueDto("false", "否"));
        List<MetadataProfileColumn> allListProfileColumn = new ArrayList<>();
        for (MetadataEventProperty eventProperty : allList) {
            if (eventProperty.getName().startsWith("G|")) {
                MetadataProfileColumn groupColumn = new MetadataProfileColumn();
                groupColumn.setCategoryId(GROUP_CAT_ID);
                groupColumn.setDisplay(1);
                groupColumn.setId(-eventProperty.getId());
                groupColumn.setName(eventProperty.getName());
                groupColumn.setShowName(eventProperty.getShowName());
                groupColumn.setType("" + typeMap.get(eventProperty.getType()));
                groupColumn.setEnumValues(enumValues);
                groupColumn.setEnumValuesList(enumValuesList);
//                list.add(groupColumn);
                allListProfileColumn.add(groupColumn);
            }
        }
        profileColumnDtoList.add(new ProfileColumnDto("用户分群", allListProfileColumn));
        example = new MetadataProfileColumnExample();
        criteria = example.createCriteria();
        criteria.andCategoryIdEqualTo(999);
        criteria.andTypeEqualTo("3");
        List<MetadataProfileColumn> tags = iMetadataProfileColumnService.selectByExample(example);
        List<MetadataProfileColumn> tagsListProfileColumn = new ArrayList<>();
        if (CollectionUtils.isNotEmpty(tags)) {
            for (MetadataProfileColumn tag : tags) {
                String[] arr = tag.getEnumValues().split(",");
                for (String en : arr) {
                    String[] ens = en.split("=");
                    if (ens.length == 2) {
                        MetadataProfileColumn tagColumn = new MetadataProfileColumn();
                        tagColumn.setCategoryId(tag.getCategoryId());
                        tagColumn.setDisplay(1);
                        tagColumn.setId(tag.getId() + 100000);
                        tagColumn.setName("temp_tags_" + ens[0].trim());
                        tagColumn.setShowName(tag.getShowName() + "-" + ens[1].trim());
                        tagColumn.setType(tag.getType());
                        tagColumn.setEnumValues(enumValues);
                        tagColumn.setEnumValuesList(enumValuesList);
//                        list.add(tagColumn);
                        tagsListProfileColumn.add(tagColumn);
                    }
                }
            }
        }
        profileColumnDtoList.add(new ProfileColumnDto("temp_tags", tagsListProfileColumn));
        return new Response(profileColumnDtoList);
    }

    @ApiOperation(value = "画像属性比较符列表", notes = "画像属性比较符列表")
    @GetMapping("/profile/column/operation")
    @ResponseBody
    public Response profileColumnOperation(Integer type) {
        List<Operation> operations = metadataUtil.profileOperationList(type);
        return new Response(operations);
    }

    @ApiOperation(value = "枚举值列表", notes = "枚举值列表")
    @GetMapping("/profile/column/enumValues")
    @ResponseBody
    public Response<List<EnumValueDto>> profileColumnEnumValues(@RequestParam(required = false) String column, @RequestHeader(value = "ldapUsername", required = false) String operator) {
        MetadataProfileColumn search = new MetadataProfileColumn();
        if (StringUtils.isNotEmpty(column)) {
            search.setName(column);
        }
        List<EnumValueDto> enumValueDtos = new ArrayList<>();
        List<MetadataProfileColumn> list = iMetadataProfileColumnService.select(search);
        if (CollectionUtils.isNotEmpty(list)) {
            String enumValues = list.get(0).getEnumValues();
            String[] enumValuesArr = enumValues.split(",");
            for (int i = 0; i < enumValuesArr.length; i++) {
                String enumV = enumValuesArr[i];
                String[] enumVArr = enumV.split("=");
                if (enumVArr.length < 2) {
                    continue;
                }
                EnumValueDto enumValueDto = new EnumValueDto(enumVArr[0], enumVArr[1]);
                enumValueDtos.add(enumValueDto);
            }
        }
        return new Response(enumValueDtos);
    }

    @ApiOperation(value = "枚举值列表", notes = "枚举值列表")
    @GetMapping("/profile/column/values")
    @ResponseBody
    public Response<List<String>> profileColumnValues(@RequestParam(required = false) String column, @RequestHeader(value = "ldapUsername", required = false) String operator) {
        List<String> values = new ArrayList<>();
        MetadataProfileColumn search = new MetadataProfileColumn();
        if (StringUtils.isNotEmpty(column)) {
            search.setName(column);
        }
        List<MetadataProfileColumn> list = iMetadataProfileColumnService.select(search);
        if (CollectionUtils.isNotEmpty(list)) {
            String enumValues = list.get(0).getEnumValues();
            String[] enumValuesArr = enumValues.split(",");
            for (int i = 0; i < enumValuesArr.length; i++) {
                String enumV = enumValuesArr[i];
                String[] enumVArr = enumV.split("=");
                if (enumVArr.length < 2) {
                    continue;
                }
                values.add(enumVArr[0]);
            }
        }
        return new Response(values);
    }

    @ApiOperation(value = "全埋点列表", notes = "全埋点列表")
    @GetMapping("/eventProperties")
    @ResponseBody
    public Response<MetadataEvent> eventProperties(@RequestHeader(value = "ldapUsername", required = false) String operator) {
        MetadataEventProperty commonSearch = new MetadataEventProperty();
        commonSearch.setEventName("all");
        List<MetadataEventProperty> commonList = new ArrayList<>();
        List<MetadataEventProperty> allList = iMetadataEventPropertyService.select(commonSearch);
        for (MetadataEventProperty eventProperty : allList) {
            //去除分群属性
            if (!eventProperty.getName().startsWith("G|")) {
                commonList.add(eventProperty);
            }
        }
        Set<String> commonPros = metadataUtil.getCommonPros();
        for (MetadataEventProperty eventProperty : commonList) {
            if (commonPros.contains(eventProperty.getName())) {
                eventProperty.setName("C|" + eventProperty.getName());
                eventProperty.setShowName("通用属性|" + eventProperty.getShowName());
            }
        }
        MetadataEvent search = new MetadataEvent();
        List<MetadataEvent> list = iMetadataEventService.select(search);
        for (MetadataEvent metadataEvent : list) {
            MetadataEventProperty search2 = new MetadataEventProperty();
            search2.setEventName(metadataEvent.getName());
            List<MetadataEventProperty> list2 = iMetadataEventPropertyService.select(search2);
            list2.addAll(commonList);
            metadataEvent.setProperties(list2);
        }
        List<VirtualEventWithBLOBs> virtualEvents = iVirtualEventService.select(null);
        for (VirtualEventWithBLOBs virtualEvent : virtualEvents) {
            MetadataEvent v = new MetadataEvent();
            v.setName("V|" + virtualEvent.getName());
            v.setShowName("虚拟事件|" + virtualEvent.getDisplayName());
            v.setDisplay(virtualEvent.getDisplay());
            v.setDescription(virtualEvent.getDescription());
            Set<String> eventSet = new HashSet<>();
            List<MetadataEventProperty> vProperties = new ArrayList<>();
            vProperties.addAll(commonList);
            List<EventDto> eventDtos = JSONArray.parseArray(virtualEvent.getEventFilter(), EventDto.class);
            for (EventDto eventDto : eventDtos) {
                eventSet.add(eventDto.getEvent());
            }
            if (CollectionUtils.isNotEmpty(eventSet)) {
                String[] eventArray = eventSet.toArray(new String[eventSet.size()]);
                if (eventArray.length == 1) {
                    MetadataEventProperty searchItem = new MetadataEventProperty();
                    searchItem.setEventName(eventArray[0]);
                    List<MetadataEventProperty> properties = iMetadataEventPropertyService.select(searchItem);
                    vProperties.addAll(properties);
                } else {
                    List<MetadataEventProperty> properties = iMetadataEventPropertyService.selectCommonProperty(eventArray, new HashSet<>(Arrays.asList(eventArray)).size());
                    vProperties.addAll(properties);
                }
            }
            v.setProperties(vProperties);
            v.setSql(virtualEvent.getEventSql());
            list.add(v);
        }
        return new Response(list);
    }

    @ApiOperation(value = "按查看列表", notes = "按查看列表")
    @GetMapping("/byField")
    @ResponseBody
    public Response byField(@RequestParam(value = "events", required = false) String events, @RequestParam(value = "returnType", required = false, defaultValue = "list") String returnType) {
        List<MetadataEventProperty> byList = new ArrayList<>();
        MetadataEventProperty searchItem = new MetadataEventProperty();
        searchItem.setDisplay(1);
        if (StringUtils.isNotEmpty(events)) {
            Set<String> eventSet = new HashSet<>();
            String[] eventArray = events.split(",");
            for (String e : eventArray) {
                if (e.startsWith("V|")) {
                    log.info(e);
                    VirtualEventWithBLOBs virtualEventWithBLOBs = iVirtualEventService.selectByName(e.substring(2));
                    if (virtualEventWithBLOBs != null && StringUtils.isNotEmpty(virtualEventWithBLOBs.getEventFilter())) {
                        List<EventDto> vEvents = JSONArray.parseArray(virtualEventWithBLOBs.getEventFilter(), EventDto.class);
                        if (CollectionUtils.isNotEmpty(vEvents)) {
                            for (EventDto eventDto : vEvents) {
                                eventSet.add(eventDto.getEvent());
                            }
                        }
                    }
                } else {
                    eventSet.add(e);
                }
            }
            if (eventSet.size() == 1) {
                searchItem = new MetadataEventProperty();
                searchItem.setEventName(eventSet.toArray(new String[]{})[0]);
                List<MetadataEventProperty> properties = iMetadataEventPropertyService.select(searchItem);
                if (CollectionUtils.isNotEmpty(properties)) {
                    for (MetadataEventProperty property : properties) {
                        if ("list".equals(returnType)) {
                            property.setShowName("私有属性|" + property.getShowName());
                        }
                        property.setCategory("P");
                        byList.add(property);
                    }
                }
            } else {
                for (String event:eventArray){
                    searchItem = new MetadataEventProperty();
                    searchItem.setEventName(event);
                List<MetadataEventProperty> properties = iMetadataEventPropertyService.select(searchItem);
//                List<MetadataEventProperty> properties = iMetadataEventPropertyService.selectCommonProperty(eventSet.toArray(new String[]{}), eventSet.size());
                if (CollectionUtils.isNotEmpty(properties)) {
                    for (MetadataEventProperty property : properties) {
                        if ("list".equals(returnType)) {
                            property.setShowName("私有属性|" + property.getShowName());
                        }
                        property.setCategory("P");
                        byList.add(property);
                    }
                }
                }
            }
        }
        searchItem = new MetadataEventProperty();
        searchItem.setEventName("all");
        searchItem.setDisplay(1);
        List<MetadataEventProperty> commonList = iMetadataEventPropertyService.select(searchItem);
        Set<String> commonPros = metadataUtil.getCommonPros();
        for (MetadataEventProperty eventProperty : commonList) {
            if (commonPros.contains(eventProperty.getName())) {
                eventProperty.setName("C|" + eventProperty.getName());
                if ("list".equals(returnType)) {
                    eventProperty.setShowName("通用属性|" + eventProperty.getShowName());
                }
                eventProperty.setCategory("C");
                byList.add(eventProperty);
            }
        }
        for (MetadataEventProperty eventProperty : commonList) {
            if (eventProperty.getName().startsWith("E")) {
                if ("list".equals(returnType)) {
                    eventProperty.setShowName("实验标签|" + eventProperty.getName());
                }
                eventProperty.setCategory("E");
                //byList.add(eventProperty);
            }
        }
        for (MetadataEventProperty eventProperty : commonList) {
            if (eventProperty.getName().startsWith("G|")) {
                if ("list".equals(returnType)) {
                    eventProperty.setShowName("用户分群|" + eventProperty.getShowName());
                }
                eventProperty.setCategory("G");
                //byList.add(eventProperty);
            }
        }
        MetadataProfileColumn search = new MetadataProfileColumn();
        List<MetadataProfileColumn> list = iMetadataProfileColumnService.select(search);
        for (MetadataProfileColumn metadataProfileColumn : list) {
            //自定义标签不支持按xx分组查看
            if (metadataProfileColumn.getName().startsWith("temp_tags")) {
                String[] arr = metadataProfileColumn.getEnumValues().split(",");
                for (String en : arr) {
                    String[] ens = en.split("=");
                    if (ens.length == 2) {
                        MetadataEventProperty tagColumn = new MetadataEventProperty();
                        tagColumn.setDisplay(1);
                        tagColumn.setId(metadataProfileColumn.getId() + 100000);
                        tagColumn.setName("temp_tags_" + ens[0].trim());
                        tagColumn.setShowName(metadataProfileColumn.getShowName() + "-" + ens[1].trim());
                        tagColumn.setType(metadataProfileColumn.getType());
                        // 定制标签设定分类为 T
                        tagColumn.setCategory("T");
                        //byList.add(tagColumn);
                    }
                }
            } else if (!metadataProfileColumn.getName().equals("uid")) {
                MetadataEventProperty eventProperty = new MetadataEventProperty();
                eventProperty.setId(metadataProfileColumn.getId());
                eventProperty.setEventName("all");
                eventProperty.setName("U|" + metadataProfileColumn.getName());
                if ("list".equals(returnType)) {
                    eventProperty.setShowName("用户属性|" + metadataProfileColumn.getShowName());
                } else {
                    eventProperty.setShowName(metadataProfileColumn.getShowName());
                }
                eventProperty.setType(typeMap2.get(Integer.valueOf(metadataProfileColumn.getType())));
                eventProperty.setCategory("U");
                byList.add(eventProperty);
            }
        }
        String[] eventArray = events.split(",");
        for (String event : eventArray) {
            List<DimColumn> columns = iDimService.selectDimColumns(event);
            for (DimColumn column : columns) {
                MetadataEventProperty eventProperty = new MetadataEventProperty();
                eventProperty.setEventName(event);
                eventProperty.setName("D|" + column.getId());
                if ("list".equals(returnType)) {
                    eventProperty.setShowName("维度表|" + column.getShowName());
                } else {
                    eventProperty.setShowName(column.getShowName());
                }
                eventProperty.setType(column.getType());
                eventProperty.setCategory("D");
                byList.add(eventProperty);
            }
        }
        if ("map".equals(returnType)) {
            Map<String, List<MetadataEventProperty>> map = new LinkedHashMap<>();
            for (MetadataEventProperty metadataEventProperty : byList) {
                if (!map.containsKey(metadataEventProperty.getCategory())) {
                    map.put(metadataEventProperty.getCategory(), new ArrayList<MetadataEventProperty>());
                }
                List<MetadataEventProperty> pList = map.get(metadataEventProperty.getCategory());
                pList.add(metadataEventProperty);
            }
            return new Response(map);
        } else {
            return new Response(byList);
        }
    }

    @ApiOperation(value = "埋点列表", notes = "埋点列表")
    @GetMapping("/eventOnly")
    @ResponseBody
    public Response<MetadataEvent> eventOnly() {
        MetadataEvent search = new MetadataEvent();
        search.setDisplay(1);
        List<MetadataEvent> list = iMetadataEventService.select(search);
        Collections.sort(list, new Comparator<MetadataEvent>() {

            @Override
            public int compare(MetadataEvent o1, MetadataEvent o2) {
                int result = o2.getSort().compareTo(o1.getSort());
                if (result == 0) {
                    return o1.getShowName().compareTo(o2.getShowName());
                } else {
                    return result;
                }
            }
        });
        return new Response(list);
    }

    @ApiOperation(value = "埋点纯属性列表", notes = "埋点纯属性列表")
    @GetMapping("/event/propertyOnly")
    @ResponseBody
    public Response propertyOnly(String event, @RequestHeader(value = "ldapUsername", required = false) String operator) {
        MetadataEventProperty commonSearch = new MetadataEventProperty();
        commonSearch.setEventName("all");
        commonSearch.setDisplay(1);
        List<MetadataEventProperty> commonList = iMetadataEventPropertyService.select(commonSearch);
        List<MetadataEventProperty> filteredList = new ArrayList<>();
        Set<String> commonPros = metadataUtil.getCommonPros();
        for (MetadataEventProperty eventProperty : commonList) {
            if (eventProperty.getName().startsWith("E") || eventProperty.getName().startsWith("G")) {
                continue;
            }
            if (commonPros.contains(eventProperty.getName())) {
                eventProperty.setName("C|" + eventProperty.getName());
                eventProperty.setShowName("通用属性|" + eventProperty.getShowName());
            }
            filteredList.add(eventProperty);
        }
        if (event.startsWith("V|")) {
            event = event.substring(2);
            Set<String> eventSet = new HashSet<>();
            VirtualEventWithBLOBs virtualEventWithBLOBs = iVirtualEventService.selectByName(event);
            if (virtualEventWithBLOBs != null) {
                List<EventDto> eventDtos = JSONArray.parseArray(virtualEventWithBLOBs.getEventFilter(), EventDto.class);
                for (EventDto eventDto : eventDtos) {
                    eventSet.add(eventDto.getEvent());
                }
            }
            String[] eventArray = eventSet.toArray(new String[eventSet.size()]);
            if (eventArray.length == 1) {
                MetadataEventProperty searchItem = new MetadataEventProperty();
                searchItem.setEventName(eventArray[0]);
                List<MetadataEventProperty> properties = iMetadataEventPropertyService.select(searchItem);
                filteredList.addAll(properties);
            } else {
                List<MetadataEventProperty> properties = iMetadataEventPropertyService.selectCommonProperty(eventArray, new HashSet<>(Arrays.asList(eventArray)).size());
                filteredList.addAll(properties);
            }
            return new Response(filteredList);
        }
        MetadataEventProperty search = new MetadataEventProperty();
        search.setEventName(event);
        search.setDisplay(1);
        List<MetadataEventProperty> list = iMetadataEventPropertyService.select(search);
        list.addAll(filteredList);
        Collections.sort(list, new Comparator<MetadataEventProperty>() {

            @Override
            public int compare(MetadataEventProperty o1, MetadataEventProperty o2) {
                int result = o2.getSort().compareTo(o1.getSort());
                if (result == 0) {
                    return o1.getShowName().compareTo(o2.getShowName());
                } else {
                    return result;
                }
            }
        });
        return new Response(list);
    }

    @ApiOperation(value = "埋点属性", notes = "埋点属性")
    @GetMapping("/properties")
    @ResponseBody
    public Response properties(@RequestParam(value = "types", required = false) String types, @RequestParam(value = "events", required = false) String events) {
        List<MetadataEventProperty> allList = new ArrayList<>();
        if (StringUtils.isNotEmpty(types)) {
            Boolean multi = false;
            Set<String> typeSet = new HashSet<>(Arrays.asList(types.split(",")));
            if (typeSet.size() > 1) {
                multi = true;
            }
            if (typeSet.contains("P")) {
                if (StringUtils.isNotEmpty(events)) {
                    if (events.startsWith("V|")) {
                        String event = events.substring(2);
                        VirtualEventWithBLOBs virtualEventWithBLOBs = iVirtualEventService.selectByName(event);
                        if (virtualEventWithBLOBs != null) {
                            Set<String> eventSet = new HashSet<>();
                            List<EventDto> eventDtos = JSONArray.parseArray(virtualEventWithBLOBs.getEventFilter(), EventDto.class);
                            for (EventDto eventDto : eventDtos) {
                                eventSet.add(eventDto.getEvent());
                            }
                            events = Joiner.on(",").join(eventSet);
                        }
                    }
                    String[] eventArray = events.split(",");
                    if (eventArray.length == 1) {
                        MetadataEventProperty searchItem = new MetadataEventProperty();
                        searchItem.setEventName(eventArray[0]);
                        List<MetadataEventProperty> properties = iMetadataEventPropertyService.select(searchItem);
                        if (CollectionUtils.isNotEmpty(properties)) {
                            for (MetadataEventProperty property : properties) {
                                if (multi) property.setShowName("私有属性|" + property.getShowName());
                                allList.add(property);
                            }
                        }
                    } else {
                        for (String event : eventArray) {
                            MetadataEventProperty searchItem = new MetadataEventProperty();
                            searchItem.setEventName(event);
                            List<MetadataEventProperty> properties = iMetadataEventPropertyService.select(searchItem);
                            if (CollectionUtils.isNotEmpty(properties)) {
                                for (MetadataEventProperty property : properties) {
                                    if (multi) {
                                        property.setShowName("私有属性|" + property.getShowName());
                                    } else {
                                        property.setShowName(event + "." + property.getShowName());
                                    }
                                    allList.add(property);
                                }
                            }
                        }
                    }
                }
            }
            if (typeSet.contains("U")) {
                MetadataProfileColumn search = new MetadataProfileColumn();
                List<MetadataProfileColumn> list = iMetadataProfileColumnService.select(search);
                for (MetadataProfileColumn metadataProfileColumn : list) {
                    MetadataEventProperty eventProperty = new MetadataEventProperty();
                    eventProperty.setId(metadataProfileColumn.getId());
                    eventProperty.setEventName("all");
                    eventProperty.setName("U|" + metadataProfileColumn.getName());
                    if (multi) {
                        eventProperty.setShowName("用户属性|" + metadataProfileColumn.getShowName());
                    } else {
                        eventProperty.setShowName(metadataProfileColumn.getShowName());
                    }
                    eventProperty.setType(typeMap2.get(Integer.valueOf(metadataProfileColumn.getType())));
                    allList.add(eventProperty);
                }
            }
            if (typeSet.contains("G")) {
                MetadataEventProperty groupSearch = new MetadataEventProperty();
                groupSearch.setEventName("all");
                List<MetadataEventProperty> groupList = iMetadataEventPropertyService.select(groupSearch);
                for (MetadataEventProperty eventProperty : groupList) {
                    if (multi) eventProperty.setShowName("用户分群|" + eventProperty.getShowName());
                    if (eventProperty.getName().startsWith("G|")) {
                        allList.add(eventProperty);
                    }
                }
            }
            if (typeSet.contains("C")) {
                MetadataEventProperty commonSearch = new MetadataEventProperty();
                commonSearch.setEventName("all");
                List<MetadataEventProperty> commonList = iMetadataEventPropertyService.select(commonSearch);
                Set<String> commonPros = metadataUtil.getCommonPros();
                for (MetadataEventProperty eventProperty : commonList) {
                    if (commonPros.contains(eventProperty.getName())) {
                        eventProperty.setName("C|" + eventProperty.getName());
                        if (multi) eventProperty.setShowName("通用属性|" + eventProperty.getShowName());
                        allList.add(eventProperty);
                    }
                }
            }
            if (typeSet.contains("E")) {
                MetadataEventProperty commonSearch = new MetadataEventProperty();
                commonSearch.setEventName("all");
                List<MetadataEventProperty> artemisLabels = iMetadataEventPropertyService.select(commonSearch);
                for (MetadataEventProperty eventProperty : artemisLabels) {
                    if (eventProperty.getName().startsWith("E")) {
                        if (multi) eventProperty.setShowName("实验标签|" + eventProperty.getShowName());
                        allList.add(eventProperty);
                    }
                }
            }
            if (typeSet.contains("D")) {
                if (events.startsWith("V|")) {
                    String event = events.substring(2);
                    VirtualEventWithBLOBs virtualEventWithBLOBs = iVirtualEventService.selectByName(event);
                    if (virtualEventWithBLOBs != null) {
                        Set<String> eventSet = new HashSet<>();
                        List<EventDto> eventDtos = JSONArray.parseArray(virtualEventWithBLOBs.getEventFilter(), EventDto.class);
                        for (EventDto eventDto : eventDtos) {
                            eventSet.add(eventDto.getEvent());
                        }
                        events = Joiner.on(",").join(eventSet);
                    }
                }
                String[] eventArray = events.split(",");
                for (String event : eventArray) {
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
                        allList.add(eventProperty);
                    }
                }
            }
        }
        return new Response(allList);
    }

    @ApiOperation(value = "埋点属性", notes = "埋点属性")
    @GetMapping("/global/properties")
    @ResponseBody
    public Response globalProperties(@RequestParam(value = "types", required = false) String types, @RequestParam(value = "events", required = false) String events, @RequestParam(value = "returnType", required = false, defaultValue = "list") String returnType) {
        List<MetadataEventProperty> allList = new ArrayList<>();
        if (StringUtils.isNotEmpty(types)) {
            Boolean multi = false;
            Set<String> typeSet = new HashSet<>(Arrays.asList(types.split(",")));
            if (typeSet.size() > 1 && "list".equals(returnType)) {
                multi = true;
            }
            if (typeSet.contains("P")) {
                if (StringUtils.isNotEmpty(events)) {
                    if (events.startsWith("V|")) {
                        String event = events.substring(2);
                        VirtualEventWithBLOBs virtualEventWithBLOBs = iVirtualEventService.selectByName(event);
                        if (virtualEventWithBLOBs != null) {
                            Set<String> eventSet = new HashSet<>();
                            List<EventDto> eventDtos = JSONArray.parseArray(virtualEventWithBLOBs.getEventFilter(), EventDto.class);
                            for (EventDto eventDto : eventDtos) {
                                eventSet.add(eventDto.getEvent());
                            }
                            events = Joiner.on(",").join(eventSet);
                        }
                    }
                    String[] eventArray = events.split(",");
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
                        // new HashSet<>(Arrays.asList(s)) 修复公共属性交集 bug
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
                    //自定义标签不支持按xx分组查看
                    if (metadataProfileColumn.getName().startsWith("temp_tags")) {
                        String[] arr = metadataProfileColumn.getEnumValues().split(",");
                        for (String en : arr) {
                            String[] ens = en.split("=");
                            if (ens.length == 2) {
                                MetadataEventProperty tagColumn = new MetadataEventProperty();
                                tagColumn.setDisplay(1);
                                tagColumn.setId(metadataProfileColumn.getId() + 100000);
                                tagColumn.setName("temp_tags_" + ens[0].trim());
                                tagColumn.setShowName(metadataProfileColumn.getShowName() + "-" + ens[1].trim());
                                tagColumn.setType(metadataProfileColumn.getType());
                                // 定制标签设定分类为 T
                                tagColumn.setCategory("T");
                                allList.add(tagColumn);
                            }
                        }
                    } else if (!metadataProfileColumn.getName().equals("uid")) {
                        MetadataEventProperty eventProperty = new MetadataEventProperty();
                        eventProperty.setId(metadataProfileColumn.getId());
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
                Set<String> commonPros = metadataUtil.getCommonPros();
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
                if (StringUtils.isNotEmpty(events)) {
                    if (events.startsWith("V|")) {
                        String event = events.substring(2);
                        VirtualEventWithBLOBs virtualEventWithBLOBs = iVirtualEventService.selectByName(event);
                        if (virtualEventWithBLOBs != null) {
                            Set<String> eventSet = new HashSet<>();
                            List<EventDto> eventDtos = JSONArray.parseArray(virtualEventWithBLOBs.getEventFilter(), EventDto.class);
                            for (EventDto eventDto : eventDtos) {
                                eventSet.add(eventDto.getEvent());
                            }
                            events = Joiner.on(",").join(eventSet);
                        }
                    }
                    String[] eventArray = events.split(",");
                    for (String event : eventArray) {
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

    private void setChildren(ViewByDto viewByDto, String name, String type) {
        List<ViewByDto> childrenList = new ArrayList<>();
        if ("number".equals(type) || "int".equals(type) || "long".equals(type) || "double".equals(type)) {
            childrenList.add(new ViewByDto("总和", "sum(cast(" + name + " as float))"));
            childrenList.add(new ViewByDto("均值", "avg(cast(" + name + " as float))"));
            childrenList.add(new ViewByDto("最大值", "max(cast(" + name + " as float))"));
            childrenList.add(new ViewByDto("最小值", "min(cast(" + name + " as float))"));
        }
        childrenList.add(new ViewByDto("去重数", "count(distinct " + name + ")"));
        viewByDto.setChildren(childrenList);
    }

    private void setChildrenForTenet(ViewByDto viewByDto, String type) {
        List<ViewByDto> childrenList = new ArrayList<>();
        if ("number".equals(type) || "int".equals(type) || "long".equals(type) || "double".equals(type)) {
            childrenList.add(new ViewByDto("总和", "2"));
            childrenList.add(new ViewByDto("均值", "3"));
        }
        childrenList.add(new ViewByDto("去重数", "1"));
        viewByDto.setChildren(childrenList);
    }

    @ApiOperation(value = "属性分析显示列表", notes = "属性分析显示列表")
    @GetMapping("/userprofile/viewBy")
    @ResponseBody
    public Response userprofileViewBy() {
        List<ViewByDto> allList = new ArrayList<>();
        allList.add(new ViewByDto("用户数", "count(1)"));
        MetadataProfileColumn search = new MetadataProfileColumn();
        List<MetadataProfileColumn> list = iMetadataProfileColumnService.select(search);
        for (MetadataProfileColumn metadataProfileColumn : list) {
            //自定义标签不支持按xx分组查看
            if (metadataProfileColumn.getName().startsWith("temp_tags")) continue;
            ViewByDto viewByDto = new ViewByDto();
            viewByDto.setLabel(metadataProfileColumn.getShowName());
            viewByDto.setValue(metadataProfileColumn.getName());
            allList.add(viewByDto);
            setChildren(viewByDto, metadataProfileColumn.getName(), typeMap2.get(Integer.valueOf(metadataProfileColumn.getType())));
        }
        MetadataEventProperty groupSearch = new MetadataEventProperty();
        groupSearch.setDisplay(1);
        groupSearch.setEventName("all");
        List<MetadataEventProperty> groupList = iMetadataEventPropertyService.select(groupSearch);
        for (MetadataEventProperty property : groupList) {
            if (property.getName().startsWith("G|")) {
                ViewByDto viewByDto = new ViewByDto();
                viewByDto.setLabel(property.getShowName());
                viewByDto.setValue(property.getName());
                allList.add(viewByDto);
                String groupId = property.getName().substring(2);
                String name = "json_array_contains_any(group_ids,'" + groupId + "')";
                setChildren(viewByDto, name, "string");
            }
        }
        return new Response(allList);
    }

    @ApiOperation(value = "事件分析显示列表", notes = "事件分析显示列表")
    @GetMapping("/event/viewBy")
    @ResponseBody
    public Response eventViewBy(String event) {
        List<ViewByDto> allList = new ArrayList<>();
        allList.add(new ViewByDto("总次数", "count(1)"));
        allList.add(new ViewByDto("用户数", "count(distinct uid)"));
        allList.add(new ViewByDto("人均次数", "count(1)/count(distinct uid)"));
        allList.add(new ViewByDto("近似用户数","approx_count_distinct(uid)"));
        allList.add(new ViewByDto("收入总和","sum(ifly_map_get(tags,'d_price'))"));
        return new Response(allList);
        /*
        MetadataEventProperty searchItem = new MetadataEventProperty();
        searchItem.setDisplay(1);
        searchItem.setEventName(event);
        List<MetadataEventProperty> properties = iMetadataEventPropertyService.select(searchItem);
        for (MetadataEventProperty property : properties) {
            ViewByDto viewByDto = new ViewByDto();
            viewByDto.setLabel("私有属性|" + property.getShowName());
            viewByDto.setValue("P|" + property.getName());
            allList.add(viewByDto);
//            setChildren(viewByDto, "get_json_object(properties,'$." + property.getName() + "')", property.getType());
            setChildren(viewByDto, "ifly_map_get(tags,'" + property.getName() + "')", property.getType());

        }
        MetadataEventProperty commonSearch = new MetadataEventProperty();
        commonSearch.setDisplay(1);
        commonSearch.setEventName("all");
        List<MetadataEventProperty> commonList = iMetadataEventPropertyService.select(commonSearch);
        Set<String> commonPros = metadataUtil.getCommonPros();
        for (MetadataEventProperty property : commonList) {
            if (commonPros.contains(property.getName())) {
                ViewByDto viewByDto = new ViewByDto();
                viewByDto.setLabel("通用属性|" + property.getShowName());
                viewByDto.setValue("C|" + property.getName());
                allList.add(viewByDto);
                setChildren(viewByDto, property.getName(), property.getType());
            }
        }
        for (MetadataEventProperty property : commonList) {
            if (property.getName().startsWith("E")) {
                ViewByDto viewByDto = new ViewByDto();
                viewByDto.setLabel("实验标签|" + property.getShowName());
                viewByDto.setValue(property.getName());
                allList.add(viewByDto);
                setChildren(viewByDto, "get_json_object(properties,'$." + property.getName() + "')", property.getType());
            }
        }
        return new Response(allList);

         */
    }

    @ApiOperation(value = "事件分析显示列表", notes = "事件分析显示列表")
    @GetMapping("/event/viewByForTenet")
    @ResponseBody
    public Response eventViewByForTenet(String events) {
        List<ViewByDto> allList = new ArrayList<>();
        allList.add(new ViewByDto("总次数", "count_all"));
        String[] eventArr = events.split(",");
        List<MetadataEventProperty> properties = iMetadataEventPropertyService.selectCommonProperty(eventArr, new HashSet<>(Arrays.asList(eventArr)).size());
        for (MetadataEventProperty property : properties) {
            ViewByDto viewByDto = new ViewByDto();
            viewByDto.setLabel("私有属性|" + property.getShowName());
            viewByDto.setValue("P|" + property.getName());
            allList.add(viewByDto);
            setChildrenForTenet(viewByDto, property.getType());
        }
        MetadataEventProperty commonSearch = new MetadataEventProperty();
        commonSearch.setDisplay(1);
        commonSearch.setEventName("all");
        List<MetadataEventProperty> commonList = iMetadataEventPropertyService.select(commonSearch);
        Set<String> commonPros = metadataUtil.getCommonPros();
        for (MetadataEventProperty property : commonList) {
            if (commonPros.contains(property.getName())) {
                ViewByDto viewByDto = new ViewByDto();
                viewByDto.setLabel("通用属性|" + property.getShowName());
                viewByDto.setValue("C|" + property.getName());
                allList.add(viewByDto);
                setChildrenForTenet(viewByDto, property.getType());
            }
        }
        return new Response(allList);
    }

    @ApiOperation(value = "埋点属性枚举值", notes = "埋点属性枚举值")
    @GetMapping("/propertyValue")
    @ResponseBody
    public Response propertyValue(String event, String property) {
        return metadataUtil.propertyValue(event, property);
    }

    @ApiOperation(value = "分析平台元数据信息", notes = "分析平台元数据信息")
    @GetMapping("/metadata/info")
    @ResponseBody
    public Response propertyValue(@RequestHeader(value = "ldapUsername") String operator, String name, Integer type) {
        return metadataUtil.metadataInfo(operator, name, type);
    }

}
