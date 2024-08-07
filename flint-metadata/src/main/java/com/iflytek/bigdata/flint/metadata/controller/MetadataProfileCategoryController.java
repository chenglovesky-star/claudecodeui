package com.iflytek.bigdata.flint.metadata.controller;

import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.common.dto.Response;
import com.iflytek.bigdata.flint.metadata.dao.model.Dim;
import com.iflytek.bigdata.flint.metadata.dao.model.DimColumn;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEventProperty;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataProfileCategory;
import com.iflytek.bigdata.flint.metadata.dto.DimDto;
import com.iflytek.bigdata.flint.metadata.service.IDimColumnService;
import com.iflytek.bigdata.flint.metadata.service.IMetadataProfileCategoryService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.apache.commons.collections.CollectionUtils;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@RestController
@Api(value = "画像标签类别接口")
@RequestMapping("/iflytek/flint/metadata/profile/category")
public class MetadataProfileCategoryController {

    @Resource
    private IMetadataProfileCategoryService IMetadataProfileCategoryService;

    @ApiOperation(value = "画像标签类别", notes = "画像标签类别")
    @GetMapping("/list")
    @ResponseBody
    public Response list(@RequestParam(value = "name", required = false) String name,
            @RequestParam(value = "showName", required = false) String showName,
            @RequestParam(value = "pageNum", required = false, defaultValue = "1") int pageNum,
            @RequestParam(value = "pageSize", required = false, defaultValue = "15") int pageSize) {
        MetadataProfileCategory metadataProfileCategory = new MetadataProfileCategory();
        metadataProfileCategory.setName(name);
        metadataProfileCategory.setShowName(showName);
        PageInfo<MetadataProfileCategory> pageInfo = IMetadataProfileCategoryService.selectByPage(metadataProfileCategory, pageNum, pageSize);
        return new Response(pageInfo);
    }

    @ApiOperation(value = "画像标签类别详情", notes = "画像标签类别详情")
    @GetMapping("/detail")
    @ResponseBody
    public Response detail(Integer id) {
        MetadataProfileCategory item = IMetadataProfileCategoryService.selectById(id);
        return new Response(item);
    }

    @ApiOperation(value = "画像标签类别新增", notes = "画像标签类别新增")
    @PostMapping("/insert")
    @ResponseBody
    public Response insert(@RequestHeader(value = "ldapUsername") String operator, @RequestBody MetadataProfileCategory item) {
        IMetadataProfileCategoryService.insert(item);
        return new Response("操作成功");
    }

    @ApiOperation(value = "画像标签类别修改", notes = "画像标签类别修改")
    @PostMapping("/update")
    @ResponseBody
    public Response update(@RequestHeader(value = "ldapUsername") String operator, @RequestBody MetadataProfileCategory item) {
        IMetadataProfileCategoryService.insert(item);
        return new Response("操作成功");
    }

    @ApiOperation(value = "画像标签类别删除", notes = "画像标签类别删除")
    @RequestMapping(value = "/delete", method = RequestMethod.DELETE)
    @ResponseBody
    public Response delete(Integer id) {
        MetadataProfileCategory item = IMetadataProfileCategoryService.selectById(id);
        if (item != null) {
            IMetadataProfileCategoryService.delete(id);
            return new Response("操作成功");
        }
        return new Response(200, "删除失败");
    }
}
