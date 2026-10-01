const server=require('../server');
module.exports=(req,res)=>{
  const u=new URL(req.url,'http://x');
  if(u.pathname==='/api/index.js'){u.searchParams.delete('__p');req.url='/'+u.search}
  server.emit('request',req,res);
};
