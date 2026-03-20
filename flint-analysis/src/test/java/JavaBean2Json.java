
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iflytek.bigdata.flint.analysis.dto.EventDetailDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iflytek.bigdata.flint.analysis.dto.EventRuleDto;
import com.iflytek.bigdata.flint.metadata.dto.EventPropertyDto;
import com.iflytek.bigdata.flint.metadata.dto.PropertyFilterDto;

import java.util.ArrayList;

/**
 * @Author: linlong
 * @Date: 2024/8/9
 * @Desc:
 */
public class JavaBean2Json {
        public static void main(String[] args) throws Exception {
            // 创建JavaBean对象
            EventDetailDto eventDetailDto = new EventDetailDto();

                eventDetailDto.setTimeValues("2024-06-10,2024-06-11");
            eventDetailDto.setChartsType(1);
            eventDetailDto.setTimeBucket(1);
            ArrayList<String> groupBy = new ArrayList<>();
            groupBy.add("age");
            groupBy.add("gender");
            eventDetailDto.setGroupBy(groupBy);
            eventDetailDto.setByValues("");
            eventDetailDto.setRequestType(Integer.valueOf(0));
            eventDetailDto.setMerge(false);
            EventRuleDto eventRuleDto = new EventRuleDto();

            eventRuleDto.setEventName("FT45113");
            eventRuleDto.setEventAlias("FT45113中文名称");
            eventRuleDto.setCountType(1); // todo

            PropertyFilterDto filter = new PropertyFilterDto();
            filter.setRelation("and");
            ArrayList<EventPropertyDto> subFilters = new ArrayList<>();
            EventPropertyDto eventPropertyDto = new EventPropertyDto();

            eventPropertyDto.setPropertyName("d_num");
            eventPropertyDto.setPropertyOperationId(16);
            eventPropertyDto.setPropertyOperationValue("0,3");
            eventPropertyDto.setSelectType(1);
            subFilters.add(eventPropertyDto);
            filter.setSubFilters(subFilters);
            eventRuleDto.setFilter(filter);
            ArrayList<EventRuleDto> eventRules = new ArrayList<>();
            eventRules.add(eventRuleDto);
            eventDetailDto.setEventRules(eventRules);
            eventDetailDto.setGlobalFilter(filter);
            // 创建ObjectMapper对象
            ObjectMapper mapper = new ObjectMapper();

            // 将JavaBean对象转为JSON字符串
            String json = mapper.writeValueAsString(eventDetailDto);

            // 打印输出JSON字符串
            System.out.println(json);

    }
}
