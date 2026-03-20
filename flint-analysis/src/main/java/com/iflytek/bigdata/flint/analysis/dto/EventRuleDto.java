package com.iflytek.bigdata.flint.analysis.dto;

import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEvent;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEventProperty;
import com.iflytek.bigdata.flint.metadata.dao.model.Operation;
import com.iflytek.bigdata.flint.metadata.dto.PropertyFilterDto;
import com.iflytek.bigdata.flint.metadata.dto.ViewByDto;
import lombok.Data;

import java.util.List;

@Data
public class EventRuleDto {

    /**
     * 指标列表，前端使用
     */
    private List<ViewByDto> viewByList;

    /**
     * 指标，前端使用
     */
    private String viewByItem;

    /**
     * 事件名称
     */
    private String eventName;

    /**
     * 事件别名
     */
    private String eventAlias;


    /**
     * 聚合类型
     */
    private Integer countType;

    /**
     * 按xx查看
     */
    private String viewBy;

    /**
     * 事件列表，由前端上传，前端使用
     */
    private List<MetadataEvent> eventList;

    /**
     * 属性比较符列表，前端上传，前端使用
     */
    private List<Operation> propertyOperationList;

    /**
     * 属性列表，前端上传，前端使用
     */
    private List<MetadataEventProperty> propertyList;

    /**
     * 属性过滤
     */
    private PropertyFilterDto filter;

}
