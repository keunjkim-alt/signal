import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryLocationsFromRows} from '../api/_lib/location-master.js';

test('inventory-only warehouses are created even when sales has never used them',()=>{
  assert.deepEqual(inventoryLocationsFromRows([
    {location_code:'DC-ONLINE',location_name:'온라인 물류센터'},
    {location_code:'DC-ONLINE',location_name:'중복'},
    {location_code:'STORE-SHANGHAI',location_name:'상하이점'}
  ]),[
    {location_code:'DC-ONLINE',location_name:'온라인 물류센터',location_type:'warehouse',country_code:'KR',timezone:'Asia/Seoul',active:true},
    {location_code:'STORE-SHANGHAI',location_name:'상하이점',location_type:'store',country_code:'CN',timezone:'Asia/Shanghai',active:true}
  ]);
});
