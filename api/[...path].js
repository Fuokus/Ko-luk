const server=require('../server');
module.exports=(req,res)=>{
  const u=new URL(req.url,'http://x'),q=req.query&&req.query.path,seg=q!==undefined?[].concat(q).join('/'):u.searchParams.get('path');
  if(seg){u.searchParams.delete('path');req.url='/api/'+seg+u.search}
  server.emit('request',req,res);
};
