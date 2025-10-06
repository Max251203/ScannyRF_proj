import os
print('DATABASE_URL =', repr(os.getenv('DATABASE_URL')))
print('PG_NAME =', repr(os.getenv('PG_NAME')))
print('PG_USER =', repr(os.getenv('PG_USER')))
print('PG_PASS =', repr(os.getenv('PG_PASS')))
print('PG_HOST =', repr(os.getenv('PG_HOST')))
print('PG_PORT =', repr(os.getenv('PG_PORT')))