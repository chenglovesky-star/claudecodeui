package com.iflytek.bigdata.flint.metadata.dto;

import com.iflytek.bigdata.flint.metadata.dao.model.MetadataProfileColumn;
import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;

/**
 * @author: longlin@iflytek.com
 * @date: 2023-02-06 15:24
 **/
@Data
@AllArgsConstructor
public class ProfileColumnDto {

    private String categoryName;

    private List<MetadataProfileColumn> profileColumnList;
}
