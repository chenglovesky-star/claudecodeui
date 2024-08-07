package com.iflytek.bigdata.flint.metadata.dto;

import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEvent;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEventProperty;
import lombok.Data;

import java.util.List;

@Data
public class EventDto {

    private String event;

    private List<MetadataEvent> eventList;

    private List<MetadataEventProperty> propertyList;

    private PropertyFilterDto filter;

    /**
     * 概览全局筛选条件
     */
    private PropertyFilterDto dashboardPropertyFilter;
}
