package com.iflytek.bigdata.flint.analysis.dto;

import com.iflytek.bigdata.flint.metadata.dto.PropertyFilterDto;
import lombok.Data;

import java.util.List;

@Data
public class EventDetailDto {

    private Long id;

    private String timeValues;

    private Integer chartsType;

    private Integer timeBucket;

    private List<String> groupBy;

    private String byValues;

    /**
     * 请求类型0普通1自定义
     */
    private Integer requestType;

    private Boolean merge;

    private List<EventRuleDto> eventRules;

    /**
     * 自定义参数
     */
    private List<UserDefineRule> userDefineRules;

    /**
     * 全局筛选条件
     */
    private PropertyFilterDto globalFilter;

    /**
     * 概览全局筛选条件
     */
    private PropertyFilterDto dashboardPropertyFilter;

    /**
     * 是否刷新缓存 0刷新 1不刷新
     */
    private Integer cache;

}
