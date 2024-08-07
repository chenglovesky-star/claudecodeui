package com.iflytek.bigdata.flint.analysis.dto;

import lombok.Data;

/**
 * @author: longlin@iflytek.com
 * @date: 2022-04-19 19:01
 **/
@Data
public class EventParamModifyDto {

    /**
     * 请求类型
     */
    private String type;

    /**
     * 请求ID
     */
    private Long id;

    /**
     * 时间区间，左右闭区间
     */
    private String timeValues;

    /**
     * 过滤之间的关系
     */
    private String eventRulesRelation;

    /**
     * 属性运算关系（等于：17,不等于：20,没值: 24, 有值 30, 模糊匹配： 34,任意包含 ：41，不匹配 47 ）
     */
    private Integer propertyOperationId;

    /**
     * 过滤属性名称
     */
    private String propertyName;

    /**
     * 过滤属性值，默认以逗号分隔
     */
    private String propertyOperationValue;

    /**
     * 缓存,默认 为1
     */
    private Integer cache;
}
