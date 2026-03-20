package com.iflytek.bigdata.flint.metadata.dto;

import lombok.Data;

import java.util.List;

@Data
public class ProfileRuleDto {

    private Long id;

    private List<ViewByDto> viewByList;

    private String viewByItem;

    private String viewBy;

    private String byField;

    private String byValues;

    private List<FiledByDto> filedByList;

    private List<UserProfileCategoryDto> categoryList;

    private String relation;

    private List<ProfileDto> rules;

    /**
     * 概览全局筛选条件
     */
    private PropertyFilterDto dashboardPropertyFilter;

}
