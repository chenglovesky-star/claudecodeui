package com.iflytek.bigdata.flint.metadata.dto;

import com.iflytek.bigdata.flint.metadata.dao.model.Operation;
import lombok.Data;

import java.io.Serializable;
import java.util.List;

@Data
public class ProfileDto implements Serializable {

    private Integer categoryId;

    private String operationName;

    private String operationValue;

    private String column;

    private Integer columnType;

    private Integer selectType;

    private List<UserProfileColumnDto> categoryColumnList;

    private List<Operation> columnOperationList;

    private List<EnumValueDto> enumValuesList;

}
