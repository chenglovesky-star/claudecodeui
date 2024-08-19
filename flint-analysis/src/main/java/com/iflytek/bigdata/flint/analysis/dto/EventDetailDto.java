package com.iflytek.bigdata.flint.analysis.dto;

import com.iflytek.bigdata.flint.metadata.dto.PropertyFilterDto;
import lombok.Data;

import java.util.List;

@Data
public class EventDetailDto {

    private Long id;

    /**
     * 时间区间 2024-06-10,2024-06-11
     */
    private String timeValues;

    /**
     * 图表类型
     */
    private Integer chartsType;

    /**
     * 时间类型 0 天，1 小时，2 分, 3 周， 4 月 ，5 总计
     */
    private Integer timeBucket;

    private List<String> groupBy;

    /**
     * 分组的区间
     */
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
