const server=require('../server');
module.exports=(req,res)=>{
  const u=new URL(req.url,'http://x'),p=u.searchParams.get('__p');
  if(p!==null){u.searchParams.delete('__p');req.url='/'+p+u.search}
  server.emit('request',req,res);
};
